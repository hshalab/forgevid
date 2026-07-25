import { NextResponse } from 'next/server'
import { getFreshSessionUser, isAdminRole } from '@/lib/rbac'
import { getHackathonEvidence } from '@/lib/hackathon-evidence'

function csv(value: unknown) {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

export async function GET() {
  const user = await getFreshSessionUser()
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const evidence = await getHackathonEvidence()
  const headers = ['userId', 'email', 'name', 'registeredAt', 'activated', 'repeatUser', 'videos', 'completed', 'exports', 'revenueUsd', 'relatedPartyRevenueUsd', 'aiCostUsd', 'testimonial', 'publicTestimonial']
  const leadHeaders = ['id', 'vertical', 'businessName', 'status', 'isRelatedParty', 'revenueCents', 'testimonialConsent', 'sampleSentAt', 'convertedAt', 'createdAt']
  const costHeaders = ['id', 'category', 'description', 'amountCents', 'incurredOn', 'notes']
  const lines = [
    '"Self-serve users"',
    headers.map(csv).join(','),
    ...evidence.rows.map((row) => headers.map((key) => csv((row as any)[key.replace('Usd', '')] ?? (row as any)[key])).join(',')),
    '',
    '"Outbound leads (dealers, realtors, e-commerce)"',
    leadHeaders.map(csv).join(','),
    ...evidence.leads.map((lead) => leadHeaders.map((key) => csv((lead as any)[key])).join(',')),
    '',
    '"Operating costs (hand-entered)"',
    costHeaders.map(csv).join(','),
    ...evidence.operatingCosts.map((cost) => costHeaders.map((key) => csv((cost as any)[key])).join(',')),
  ]
  return new NextResponse(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="forgevid-hackathon-evidence-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
