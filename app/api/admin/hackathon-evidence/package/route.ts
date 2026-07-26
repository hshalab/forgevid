import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { getFreshSessionUser, isAdminRole } from '@/lib/rbac'
import { getHackathonEvidence } from '@/lib/hackathon-evidence'
import { appendEvidence, verifyEvidenceLedger } from '@/lib/evidence-ledger'

export async function GET() {
  const user = await getFreshSessionUser()
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const evidence = await getHackathonEvidence()
  const snapshot = {
    generatedAt: evidence.generatedAt.toISOString(),
    hackathonStart: evidence.start.toISOString(),
    summary: evidence.summary,
  }
  const snapshotHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  await appendEvidence({
    kind: 'hackathon.snapshot',
    entityType: 'EvidencePackage',
    actorUserId: user.id,
    payload: { ...snapshot, snapshotHash },
  })
  const ledger = await verifyEvidenceLedger()
  const result = {
    format: 'ForgeVid Hackathon Evidence Package v1',
    snapshot,
    snapshotHash,
    chain: ledger,
    definitions: {
      revenue: 'Only succeeded, non-related-party payments and explicitly recorded arms-length lead revenue.',
      conversions: 'Customer-recorded downstream events; never inferred.',
      integrity: 'SHA-256 linked records; database triggers reject updates and deletes.',
      corrections: 'Corrections append a record with supersedesId; history is never rewritten.',
    },
  }
  return new NextResponse(JSON.stringify(result, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="forgevid-evidence-package-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
