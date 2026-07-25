import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getFreshSessionUser, isAdminRole } from '@/lib/rbac'

const LEAD_STATUSES = ['NEW', 'SAMPLE_SENT', 'REPLIED', 'MEETING', 'PILOT', 'PAID', 'RETAINED', 'DEAD'] as const

const createLeadSchema = z.object({
  vertical: z.string().min(1).max(40),
  businessName: z.string().min(1).max(200),
  contactName: z.string().max(200).optional().or(z.literal('')),
  contactEmail: z.string().email().max(255).optional().or(z.literal('')),
  contactPhone: z.string().max(60).optional().or(z.literal('')),
  source: z.string().min(1).max(60),
  notes: z.string().max(2000).optional().or(z.literal('')),
  isRelatedParty: z.boolean().optional(),
})

const updateLeadSchema = z.object({
  id: z.string().min(1),
  status: z.enum(LEAD_STATUSES).optional(),
  isRelatedParty: z.boolean().optional(),
  revenueCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  testimonialConsent: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
  sampleSentAt: z.string().datetime().nullable().optional(),
  convertedAt: z.string().datetime().nullable().optional(),
})

const deleteLeadSchema = z.object({
  id: z.string().min(1),
})

async function requireAdmin() {
  const user = await getFreshSessionUser()
  if (!user || !isAdminRole(user.role)) return null
  return user
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const leads = await prisma.lead.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ leads })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = createLeadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const lead = await prisma.lead.create({
    data: {
      userId: admin.id,
      vertical: parsed.data.vertical,
      businessName: parsed.data.businessName.trim(),
      contactName: parsed.data.contactName?.trim() || null,
      contactEmail: parsed.data.contactEmail?.trim().toLowerCase() || null,
      contactPhone: parsed.data.contactPhone?.trim() || null,
      source: parsed.data.source,
      notes: parsed.data.notes?.trim() || null,
      isRelatedParty: parsed.data.isRelatedParty ?? false,
    },
  })

  return NextResponse.json({ lead }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = updateLeadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { id, sampleSentAt, convertedAt, ...rest } = parsed.data
  const lead = await prisma.lead.update({
    where: { id },
    data: {
      ...rest,
      ...(sampleSentAt !== undefined && { sampleSentAt: sampleSentAt ? new Date(sampleSentAt) : null }),
      ...(convertedAt !== undefined && { convertedAt: convertedAt ? new Date(convertedAt) : null }),
    },
  })

  return NextResponse.json({ lead })
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = deleteLeadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  await prisma.lead.delete({ where: { id: parsed.data.id } })
  return NextResponse.json({ success: true })
}
