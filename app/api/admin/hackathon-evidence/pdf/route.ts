import { NextResponse } from 'next/server'
import { getFreshSessionUser, isAdminRole } from '@/lib/rbac'
import { getHackathonEvidence } from '@/lib/hackathon-evidence'
import { verifyEvidenceLedger } from '@/lib/evidence-ledger'
import { onePagePdf } from '@/lib/simple-pdf'

export async function GET() {
  const user = await getFreshSessionUser()
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const evidence = await getHackathonEvidence()
  const ledger = await verifyEvidenceLedger()
  const s = evidence.summary
  const pdf = onePagePdf('ForgeVid - Hackathon Evidence Summary', [
    `Generated: ${evidence.generatedAt.toISOString()}`,
    `Eligibility measurement start: ${evidence.start.toISOString()}`,
    '',
    `Users: ${s.users} | Activated: ${s.activatedUsers} | Repeat: ${s.repeatUsers}`,
    `Videos: ${s.videos} | Completed: ${s.completedVideos} | Exports: ${s.exports}`,
    `Verified self-serve revenue: $${s.revenueUsd.toFixed(2)}`,
    `Verified outbound arms-length revenue: $${s.outboundRevenueUsd.toFixed(2)}`,
    `Related-party revenue excluded: $${(s.relatedPartyRevenueUsd + s.outboundRelatedPartyRevenueUsd).toFixed(2)}`,
    `Recorded AI cost: $${s.aiCostUsd.toFixed(2)} | Operating cost: $${s.operatingCostUsd.toFixed(2)}`,
    `Outbound leads: ${s.outboundLeads} | Samples: ${s.outboundSampleSent} | Converted: ${s.outboundConverted}`,
    '',
    `Evidence chain: ${ledger.valid ? 'VALID' : 'INVALID'} | Records: ${ledger.count}`,
    `Chain head SHA-256: ${ledger.headHash}`,
    '',
    'Definitions: Revenue is never inferred. Friends/family/team rows are explicitly flagged and excluded.',
    'Downstream conversions are customer-recorded. Approval requires content-rights confirmation.',
    'The evidence ledger is append-only: PostgreSQL triggers reject UPDATE and DELETE.',
    'Corrections append superseding records. Full record payloads and hashes are in the JSON package.',
    '',
    'ForgeVid never publishes campaigns or messages prospects autonomously.',
  ])
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="forgevid-judge-summary-${new Date().toISOString().slice(0, 10)}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
