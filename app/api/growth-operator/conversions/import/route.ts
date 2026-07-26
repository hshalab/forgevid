import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { splitCsvLine } from '@/lib/listing-brief'
import { appendEvidence } from '@/lib/evidence-ledger'

const rowSchema = z.object({
  creativeId: z.string().min(1),
  kind: z.enum(['qualified_lead', 'appointment', 'sale', 'retained']),
  occurredAt: z.string().datetime(),
  revenueCents: z.number().int().min(0).max(1_000_000_00).nullable(),
  externalId: z.string().min(1).max(200),
  contactRef: z.string().max(200),
  notes: z.string().max(2000),
})

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const csv = await request.text()
  if (Buffer.byteLength(csv, 'utf8') > 2_000_000) {
    return NextResponse.json({ error: 'CSV must be 2 MB or smaller' }, { status: 413 })
  }
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2 || lines.length > 1001) {
    return NextResponse.json({ error: 'CSV requires a header and 1–1000 rows' }, { status: 400 })
  }
  const headers = splitCsvLine(lines[0]).map((value) => value.trim())
  const required = ['creativeId', 'kind', 'occurredAt', 'externalId']
  if (required.some((name) => !headers.includes(name))) {
    return NextResponse.json({ error: `Required columns: ${required.join(', ')}` }, { status: 400 })
  }
  const rows = []
  for (let index = 0; index < lines.length - 1; index += 1) {
    const cells = splitCsvLine(lines[index + 1])
    const value = (name: string) => cells[headers.indexOf(name)]?.trim() || ''
    const dollars = value('revenueUsd')
    const parsed = rowSchema.safeParse({
      creativeId: value('creativeId'),
      kind: value('kind'),
      occurredAt: value('occurredAt'),
      externalId: value('externalId'),
      contactRef: value('contactRef'),
      notes: value('notes'),
      revenueCents: dollars ? Math.round(Number(dollars) * 100) : null,
    })
    if (!parsed.success) {
      return NextResponse.json({ error: `Invalid row ${index + 2}`, details: parsed.error.flatten() }, { status: 400 })
    }
    rows.push(parsed.data)
  }
  const creativeIds = [...new Set(rows.map((row) => row.creativeId))]
  const owned = await prisma.adCreative.findMany({
    where: { userId: session.user.id, id: { in: creativeIds } },
    select: { id: true },
  })
  if (owned.length !== creativeIds.length) {
    return NextResponse.json({ error: 'One or more creatives are invalid or not owned by this account' }, { status: 403 })
  }
  const result = await prisma.growthConversion.createMany({
    data: rows.map((row) => ({
      ...row,
      userId: session.user.id,
      source: 'csv',
      currency: 'usd',
      occurredAt: new Date(row.occurredAt),
    })),
    skipDuplicates: true,
  })
  await appendEvidence({
    kind: 'conversion.csv_imported',
    entityType: 'GrowthConversionImport',
    actorUserId: session.user.id,
    payload: {
      submitted: rows.length,
      imported: result.count,
      skipped: rows.length - result.count,
      externalIds: rows.map((row) => row.externalId),
    },
  })
  return NextResponse.json({ imported: result.count, skipped: rows.length - result.count })
}
