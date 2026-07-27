import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { appendEvidence } from '@/lib/evidence-ledger'
import { recomputeCampaignPerformance } from '@/lib/ad-performance'
import { assertHeaders, ownedCreativeCampaigns, parseCsvBody, CsvImportError } from '@/lib/csv-import'

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

  let headers: string[], cellRows: string[][]
  try {
    ;({ headers, rows: cellRows } = parseCsvBody(await request.text()))
    assertHeaders(headers, ['creativeId', 'kind', 'occurredAt', 'externalId'])
  } catch (error) {
    if (error instanceof CsvImportError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }

  const rows = []
  for (let index = 0; index < cellRows.length; index += 1) {
    const cells = cellRows[index]
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
  let campaignByCreative: Map<string, string>
  try {
    campaignByCreative = await ownedCreativeCampaigns(session.user.id, creativeIds)
  } catch (error) {
    if (error instanceof CsvImportError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
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
  // Revenue changed for every campaign touched by this import.
  for (const campaignId of new Set(campaignByCreative.values())) {
    await recomputeCampaignPerformance(campaignId)
  }
  return NextResponse.json({ imported: result.count, skipped: rows.length - result.count })
}
