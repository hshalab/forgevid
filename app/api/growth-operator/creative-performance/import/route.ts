import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { appendEvidence } from '@/lib/evidence-ledger'
import { recomputeCampaignPerformance } from '@/lib/ad-performance'
import { assertHeaders, ownedCreativeCampaigns, parseCsvBody, CsvImportError } from '@/lib/csv-import'

/**
 * POST /api/growth-operator/creative-performance/import — a CSV the customer
 * exports from their OWN Meta/TikTok/Google/LinkedIn Ads dashboard: what each
 * creative has spent LIFE-TO-DATE, and how it was seen/clicked. ForgeVid has
 * no business-verified access to any ad platform's API, so this is the
 * honest alternative — read-only, customer-supplied, never inferred (same
 * posture as GrowthConversion's revenue). Recomputes ROAS/isWinner for every
 * touched campaign afterward (see lib/ad-performance.ts).
 *
 * IMPORTANT: each column is a running total, not a period delta — every
 * import REPLACES the previous value for that creative. Uploading only
 * "this month's spend" would understate lifetime spend and inflate ROAS.
 */

const rowSchema = z.object({
  creativeId: z.string().min(1),
  totalSpendCents: z.number().int().min(0).max(1_000_000_00).nullable(),
  totalImpressions: z.number().int().min(0).max(1_000_000_000).nullable(),
  totalClicks: z.number().int().min(0).max(1_000_000_000).nullable(),
})

// number on a valid cell, null when empty, undefined when unparseable.
function toNumber(raw: string, scale = 1): number | null | undefined {
  if (!raw) return null
  const n = Number(raw.replace(/[$,]/g, '')) * scale
  return Number.isFinite(n) ? Math.round(n) : undefined
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  let headers: string[], cellRows: string[][]
  try {
    ;({ headers, rows: cellRows } = parseCsvBody(await request.text()))
    assertHeaders(headers, ['creativeId'])
  } catch (error) {
    if (error instanceof CsvImportError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }

  const rows: z.infer<typeof rowSchema>[] = []
  for (let index = 0; index < cellRows.length; index += 1) {
    const cells = cellRows[index]
    const value = (name: string) => cells[headers.indexOf(name)]?.trim() || ''
    const spendUsd = value('spendUsd') || value('totalSpendUsd')
    const totalSpendCents = spendUsd
      ? toNumber(spendUsd, 100)
      : toNumber(value('totalSpendCents') || value('spendCents'))
    const totalImpressions = toNumber(value('totalImpressions') || value('impressions'))
    const totalClicks = toNumber(value('totalClicks') || value('clicks'))
    if (totalSpendCents === undefined || totalImpressions === undefined || totalClicks === undefined) {
      return NextResponse.json({ error: `Row ${index + 2}: spend/impressions/clicks must be numbers` }, { status: 400 })
    }
    const parsed = rowSchema.safeParse({
      creativeId: value('creativeId'),
      totalSpendCents,
      totalImpressions,
      totalClicks,
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

  const now = new Date()
  await prisma.$transaction(
    rows.map((row) =>
      prisma.adCreative.update({
        where: { id: row.creativeId },
        data: {
          ...(row.totalSpendCents !== null ? { totalSpendCents: row.totalSpendCents } : {}),
          ...(row.totalImpressions !== null ? { totalImpressions: row.totalImpressions } : {}),
          ...(row.totalClicks !== null ? { totalClicks: row.totalClicks } : {}),
          spendUpdatedAt: now,
        },
      }),
    ),
  )

  await appendEvidence({
    kind: 'creative_performance.csv_imported',
    entityType: 'AdCreativePerformanceImport',
    actorUserId: session.user.id,
    payload: { submitted: rows.length, creativeIds },
  })

  for (const campaignId of new Set(campaignByCreative.values())) {
    await recomputeCampaignPerformance(campaignId)
  }

  return NextResponse.json({ imported: rows.length })
}
