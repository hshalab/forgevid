jest.mock('@/lib/safe-fetch', () => ({ safeFetch: jest.fn() }))

import { safeFetch } from '@/lib/safe-fetch'
import { decodeVin, looksLikeVin } from '@/lib/vin-decoder'

const mockedFetch = safeFetch as jest.Mock

function nhtsaResponse(row: Record<string, unknown>) {
  return { body: Buffer.from(JSON.stringify({ Results: [row] })), contentType: 'application/json' }
}

describe('looksLikeVin', () => {
  it('accepts a well-formed 17-character VIN', () => {
    expect(looksLikeVin('1HGCM82633A004352')).toBe(true)
  })

  it('rejects the wrong length', () => {
    expect(looksLikeVin('1HGCM82633A00435')).toBe(false)
    expect(looksLikeVin('1HGCM82633A0043522')).toBe(false)
  })

  it('rejects VINs containing I, O, or Q', () => {
    expect(looksLikeVin('1HGCM82I33A004352')).toBe(false)
    expect(looksLikeVin('1HGCM82O33A004352')).toBe(false)
    expect(looksLikeVin('1HGCM82Q33A004352')).toBe(false)
  })

  it('rejects a plain dealer stock number', () => {
    expect(looksLikeVin('STK-4821')).toBe(false)
  })
})

describe('decodeVin', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('never calls the network for something that is not VIN-shaped', async () => {
    const result = await decodeVin('STK-4821')
    expect(result).toBeNull()
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('maps a clean decode to the expected fields', async () => {
    mockedFetch.mockResolvedValue(
      nhtsaResponse({
        ErrorCode: '0',
        ModelYear: '2022',
        Make: 'TOYOTA',
        Model: 'RAV4',
        Trim: 'XLE',
        BodyClass: 'Sport Utility Vehicle (SUV)',
        FuelTypePrimary: 'Gasoline',
        DriveType: 'AWD',
        TransmissionStyle: 'Automatic',
        EngineCylinders: '4',
      }),
    )
    const result = await decodeVin('1HGCM82633A004352')
    expect(result).toEqual({
      year: 2022,
      make: 'TOYOTA',
      model: 'RAV4',
      trim: 'XLE',
      bodyClass: 'Sport Utility Vehicle (SUV)',
      fuelType: 'Gasoline',
      driveType: 'AWD',
      transmission: 'Automatic',
      engineCylinders: '4',
    })
  })

  it('treats "Not Applicable" fields as absent', async () => {
    mockedFetch.mockResolvedValue(
      nhtsaResponse({ ErrorCode: '0', ModelYear: '2022', Make: 'TOYOTA', Model: 'RAV4', Trim: 'Not Applicable' }),
    )
    const result = await decodeVin('1HGCM82633A004352')
    expect(result?.trim).toBeUndefined()
  })

  it('returns null on a non-zero error code (unreliable decode)', async () => {
    mockedFetch.mockResolvedValue(
      nhtsaResponse({ ErrorCode: '6, Check Digit does not match', ModelYear: '2022', Make: 'TOYOTA' }),
    )
    const result = await decodeVin('1HGCM82633A004352')
    expect(result).toBeNull()
  })

  it('fails open (returns null) when the fetch throws', async () => {
    mockedFetch.mockRejectedValue(new Error('NHTSA is down'))
    const result = await decodeVin('1HGCM82633A004352')
    expect(result).toBeNull()
  })

  it('returns null when the response has no Results', async () => {
    mockedFetch.mockResolvedValue({ body: Buffer.from(JSON.stringify({ Results: [] })), contentType: 'application/json' })
    const result = await decodeVin('1HGCM82633A004352')
    expect(result).toBeNull()
  })
})
