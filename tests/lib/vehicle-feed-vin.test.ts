jest.mock('@/lib/vin-decoder', () => ({
  decodeVin: jest.fn(),
  looksLikeVin: jest.requireActual('@/lib/vin-decoder').looksLikeVin,
}))

import { decodeVin } from '@/lib/vin-decoder'
import { enrichVehicleFromVin, parseVehicleFeed, type Vehicle } from '@/lib/vehicle-feed'

const mockedDecode = decodeVin as jest.Mock

const VIN = '1HGCM82633A004352'

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    ref: VIN,
    title: 'Toyota RAV4',
    titleComposed: true, // title === composeTitle(make, model) — matches the default below
    make: 'Toyota',
    model: 'RAV4',
    photos: ['https://example.com/1.jpg'],
    ...overrides,
  }
}

describe('enrichVehicleFromVin', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not call the decoder when the vehicle is already complete', async () => {
    const v = vehicle({ year: 2022, trim: 'XLE' })
    const result = await enrichVehicleFromVin(v)
    expect(result).toEqual(v)
    expect(mockedDecode).not.toHaveBeenCalled()
  })

  it('does not call the decoder when ref is not VIN-shaped', async () => {
    const v = vehicle({ ref: 'STK-4821' })
    const result = await enrichVehicleFromVin(v)
    expect(result).toEqual(v)
    expect(mockedDecode).not.toHaveBeenCalled()
  })

  it('backfills only the missing fields and recomposes a composed title', async () => {
    mockedDecode.mockResolvedValue({
      year: 2022,
      make: 'Toyota',
      model: 'RAV4',
      trim: 'XLE',
    })
    const v = vehicle() // title === composeTitle(make, model) — no year/trim yet
    const result = await enrichVehicleFromVin(v)
    expect(result.year).toBe(2022)
    expect(result.trim).toBe('XLE')
    expect(result.title).toBe('2022 Toyota RAV4 XLE')
  })

  it('never overwrites an explicit dealer-supplied title', async () => {
    mockedDecode.mockResolvedValue({ year: 2022, make: 'Toyota', model: 'RAV4', trim: 'XLE' })
    const v = vehicle({ title: "This Year's Best RAV4 Deal!", titleComposed: false })
    const result = await enrichVehicleFromVin(v)
    expect(result.trim).toBe('XLE')
    expect(result.title).toBe("This Year's Best RAV4 Deal!")
  })

  it('never overwrites a field the feed already provided', async () => {
    mockedDecode.mockResolvedValue({ year: 1999, make: 'Honda', model: 'Civic', trim: 'Base' })
    const v = vehicle({ year: 2022, trim: 'Limited' })
    const result = await enrichVehicleFromVin(v)
    expect(result.year).toBe(2022)
    expect(result.trim).toBe('Limited')
    // make/model were also already present on v — untouched too.
    expect(result.make).toBe('Toyota')
    expect(result.model).toBe('RAV4')
  })

  it('backfills highlights from body/drivetrain/fuel only when the feed gave none', async () => {
    mockedDecode.mockResolvedValue({
      year: 2022,
      trim: 'XLE',
      bodyClass: 'Sport Utility Vehicle (SUV)',
      driveType: 'AWD',
      fuelType: 'Gasoline',
    })
    const v = vehicle()
    const result = await enrichVehicleFromVin(v)
    expect(result.highlights).toBe('Sport Utility Vehicle (SUV), AWD, Gasoline')
  })

  it('leaves existing highlights alone', async () => {
    mockedDecode.mockResolvedValue({ year: 2022, trim: 'XLE', bodyClass: 'SUV' })
    const v = vehicle({ highlights: 'One owner, garage kept' })
    const result = await enrichVehicleFromVin(v)
    expect(result.highlights).toBe('One owner, garage kept')
  })

  it('returns the vehicle unchanged when the decode fails', async () => {
    mockedDecode.mockResolvedValue(null)
    const v = vehicle()
    const result = await enrichVehicleFromVin(v)
    expect(result).toEqual(v)
  })
})

describe('parseVehicleFeed — titleComposed provenance', () => {
  it('marks titleComposed true when the feed has no title field', () => {
    const [v] = parseVehicleFeed(
      JSON.stringify([{ VIN: '1HGCM82633A004352', Make: 'Toyota', Model: 'RAV4', Photos: 'https://example.com/1.jpg' }]),
      'application/json',
    )
    expect(v.titleComposed).toBe(true)
    expect(v.title).toBe('Toyota RAV4')
  })

  it('marks titleComposed false when the feed supplies an explicit title', () => {
    const [v] = parseVehicleFeed(
      JSON.stringify([
        {
          VIN: '1HGCM82633A004352',
          Make: 'Toyota',
          Model: 'RAV4',
          Title: "This Year's Best RAV4 Deal!",
          Photos: 'https://example.com/1.jpg',
        },
      ]),
      'application/json',
    )
    expect(v.titleComposed).toBe(false)
    expect(v.title).toBe("This Year's Best RAV4 Deal!")
  })
})
