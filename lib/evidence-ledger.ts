import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const GENESIS_HASH = '0'.repeat(64)

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export interface AppendEvidenceInput {
  kind: string
  entityType?: string
  entityId?: string
  actorUserId?: string
  payload: unknown
  supersedesId?: string
}

export async function appendEvidence(input: AppendEvidenceInput) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7120260519)`
    const latest = await tx.evidenceRecord.findFirst({ orderBy: { sequence: 'desc' } })
    const sequence = (latest?.sequence ?? BigInt(0)) + BigInt(1)
    const previousHash = latest?.recordHash ?? GENESIS_HASH
    const payload = canonicalize(input.payload)
    const payloadHash = sha256(payload)
    const recordHash = sha256([
      sequence.toString(), input.kind, input.entityType || '', input.entityId || '',
      input.actorUserId || '', payloadHash, previousHash, input.supersedesId || '',
    ].join('|'))
    return tx.evidenceRecord.create({
      data: {
        sequence,
        kind: input.kind,
        entityType: input.entityType,
        entityId: input.entityId,
        actorUserId: input.actorUserId,
        payload,
        payloadHash,
        previousHash,
        recordHash,
        supersedesId: input.supersedesId,
      },
    })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function verifyEvidenceLedger() {
  const records = await prisma.evidenceRecord.findMany({ orderBy: { sequence: 'asc' } })
  let previousHash = GENESIS_HASH
  const failures: Array<{ sequence: string; reason: string }> = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const expectedSequence = BigInt(index + 1)
    if (record.sequence !== expectedSequence) failures.push({ sequence: record.sequence.toString(), reason: 'sequence gap' })
    if (record.previousHash !== previousHash) failures.push({ sequence: record.sequence.toString(), reason: 'previous hash mismatch' })
    if (sha256(record.payload) !== record.payloadHash) failures.push({ sequence: record.sequence.toString(), reason: 'payload hash mismatch' })
    const expectedHash = sha256([
      record.sequence.toString(), record.kind, record.entityType || '', record.entityId || '',
      record.actorUserId || '', record.payloadHash, record.previousHash, record.supersedesId || '',
    ].join('|'))
    if (expectedHash !== record.recordHash) failures.push({ sequence: record.sequence.toString(), reason: 'record hash mismatch' })
    previousHash = record.recordHash
  }
  return {
    valid: failures.length === 0,
    count: records.length,
    headHash: previousHash,
    failures,
    records: records.map((record) => ({ ...record, sequence: record.sequence.toString() })),
  }
}
