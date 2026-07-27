jest.mock('@/lib/prisma', () => ({
  prisma: { adCreative: { findMany: jest.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { assertHeaders, ownedCreativeCampaigns, parseCsvBody, CsvImportError } from '@/lib/csv-import'

const adCreative = prisma.adCreative as jest.Mocked<typeof prisma.adCreative>

describe('parseCsvBody', () => {
  it('splits a header and its data rows', () => {
    const { headers, rows } = parseCsvBody('a,b\n1,2\n3,4')
    expect(headers).toEqual(['a', 'b'])
    expect(rows).toEqual([['1', '2'], ['3', '4']])
  })

  it('strips a leading BOM', () => {
    const { headers } = parseCsvBody('﻿a,b\n1,2')
    expect(headers).toEqual(['a', 'b'])
  })

  it('drops blank lines', () => {
    const { rows } = parseCsvBody('a\n1\n\n2\n')
    expect(rows).toEqual([['1'], ['2']])
  })

  it('rejects a body over the byte limit', () => {
    expect(() => parseCsvBody('a\n1', { maxBytes: 2 })).toThrow(CsvImportError)
  })

  it('rejects a CSV with no data rows', () => {
    expect(() => parseCsvBody('a\n')).toThrow(CsvImportError)
  })

  it('rejects a CSV over the row-count limit', () => {
    const csv = 'a\n' + '1\n'.repeat(5)
    expect(() => parseCsvBody(csv, { maxRows: 3 })).toThrow(CsvImportError)
  })
})

describe('assertHeaders', () => {
  it('passes when every required column is present', () => {
    expect(() => assertHeaders(['a', 'b', 'c'], ['a', 'c'])).not.toThrow()
  })

  it('throws naming the required columns when one is missing', () => {
    expect(() => assertHeaders(['a'], ['a', 'b'])).toThrow('Required columns: a, b')
  })
})

describe('ownedCreativeCampaigns', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns a campaignId map for every owned creative', async () => {
    adCreative.findMany.mockResolvedValue([
      { id: 'c1', campaignId: 'camp-1' },
      { id: 'c2', campaignId: 'camp-2' },
    ] as any)
    const map = await ownedCreativeCampaigns('user-1', ['c1', 'c2'])
    expect(map.get('c1')).toBe('camp-1')
    expect(map.get('c2')).toBe('camp-2')
  })

  it('throws 403 when any creative is not owned by the caller', async () => {
    adCreative.findMany.mockResolvedValue([{ id: 'c1', campaignId: 'camp-1' }] as any)
    await expect(ownedCreativeCampaigns('user-1', ['c1', 'not-mine'])).rejects.toMatchObject({ status: 403 })
  })
})
