jest.mock('@/lib/prisma', () => {
  const records: any[] = []
  const evidenceRecord = {
    findFirst: jest.fn(async () => records.length ? records[records.length - 1] : null),
    create: jest.fn(async ({ data }: any) => {
      const record = { id: `record-${records.length + 1}`, createdAt: new Date(), ...data }
      records.push(record)
      return record
    }),
    findMany: jest.fn(async () => [...records]),
  }
  const client: any = {
    _records: records,
    evidenceRecord,
    $transaction: jest.fn(async (callback: any) => callback({
      $executeRaw: jest.fn(),
      evidenceRecord,
    })),
  }
  return { prisma: client }
})

import { prisma } from '@/lib/prisma'
import { appendEvidence, verifyEvidenceLedger } from '@/lib/evidence-ledger'

const records = (prisma as any)._records as any[]

describe('append-only evidence hash chain', () => {
  beforeEach(() => {
    records.splice(0)
    jest.clearAllMocks()
  })

  it('links canonical payload hashes in sequence', async () => {
    await appendEvidence({ kind: 'one', payload: { b: 2, a: 1 } })
    await appendEvidence({ kind: 'two', payload: { value: true } })
    expect(records[0].payload).toBe('{"a":1,"b":2}')
    expect(records[1].previousHash).toBe(records[0].recordHash)
    await expect(verifyEvidenceLedger()).resolves.toMatchObject({ valid: true, count: 2 })
  })

  it('detects payload tampering', async () => {
    await appendEvidence({ kind: 'one', payload: { genuine: true } })
    records[0].payload = '{"genuine":false}'
    const result = await verifyEvidenceLedger()
    expect(result.valid).toBe(false)
    expect(result.failures[0].reason).toBe('payload hash mismatch')
  })
})
