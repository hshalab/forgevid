import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { appendEvidence } from '@/lib/evidence-ledger'
import { recomputeCampaignPerformance } from '@/lib/ad-performance'

const conversionSchema = z.object({
  creativeId: z.string().min(1),
  kind: z.enum(['qualified_lead', 'appointment', 'sale', 'retained']),
  source: z.enum(['manual', 'csv', 'crm']).default('manual'),
  externalId: z.string().trim().max(200).optional().or(z.literal('')),
  contactRef: z.string().trim().max(200).optional().or(z.literal('')),
  revenueCents: z.number().int().min(0).max(1_000_000_00).nullable().optional(),
  currency: z.string().regex(/^[a-zA-Z]{3}$/).default('usd'),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  occurredAt: z.string().datetime(),
})

async function userId() {
  const session = await getServerSession(authOptions)
  return session?.user?.id ?? null
}

export async function GET() {
  const ownerId = await userId()
  if (!ownerId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const conversions = await prisma.growthConversion.findMany({
    where: { userId: ownerId },
    orderBy: { occurredAt: 'desc' },
    take: 500,
  })
  return NextResponse.json({ conversions })
}

export async function POST(request: NextRequest) {
  const ownerId = await userId()
  if (!ownerId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const parsed = conversionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid conversion record', details: parsed.error.flatten() }, { status: 400 })
  }
  const creative = await prisma.adCreative.findFirst({
    where: { id: parsed.data.creativeId, userId: ownerId },
    select: { id: true, campaignId: true },
  })
  if (!creative) return NextResponse.json({ error: 'Creative not found' }, { status: 404 })

  if (parsed.data.externalId) {
    const duplicate = await prisma.growthConversion.findFirst({
      where: { userId: ownerId, source: parsed.data.source, externalId: parsed.data.externalId },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json({ error: 'This external conversion was already imported' }, { status: 409 })
    }
  }

  const conversion = await prisma.growthConversion.create({
    data: {
      userId: ownerId,
      creativeId: creative.id,
      kind: parsed.data.kind,
      source: parsed.data.source,
      externalId: parsed.data.externalId || null,
      contactRef: parsed.data.contactRef || null,
      revenueCents: parsed.data.revenueCents ?? null,
      currency: parsed.data.currency.toLowerCase(),
      notes: parsed.data.notes || null,
      occurredAt: new Date(parsed.data.occurredAt),
    },
  })
  await appendEvidence({
    kind: 'conversion.recorded',
    entityType: 'GrowthConversion',
    entityId: conversion.id,
    actorUserId: ownerId,
    payload: {
      creativeId: conversion.creativeId,
      kind: conversion.kind,
      source: conversion.source,
      externalId: conversion.externalId,
      revenueCents: conversion.revenueCents,
      currency: conversion.currency,
      occurredAt: conversion.occurredAt.toISOString(),
    },
  })
  // Revenue just changed for this creative — ROAS/isWinner across the whole
  // campaign may have too.
  await recomputeCampaignPerformance(creative.campaignId)
  return NextResponse.json({ conversion }, { status: 201 })
}
