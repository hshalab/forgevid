import { describe, it, expect } from '@jest/globals'
import { followUpsDue, parseTracker, pickDailyBatch, type TrackerRow } from '@/lib/growth-ops'

const HEADER =
  'status,name,website,city,metro,phone,inventory_estimate,contact_name,contact_role,linkedin,email,instagram,whatsapp,language,sample_sent,sample_date,response,meeting,pilot,revenue,testimonial_permission,notes'

function row(overrides: Partial<TrackerRow> = {}): TrackerRow {
  return {
    status: 'NEW', name: 'Dealer', website: 'https://x.com', city: 'Miami', metro: 'Miami',
    phone: '', contactName: '', email: '', instagram: '', whatsapp: '', language: 'EN',
    sampleSent: '', sampleDate: '', response: '', notes: '',
    ...overrides,
  }
}

describe('parseTracker', () => {
  it('parses the real 22-column layout, respecting quoted commas in notes', () => {
    const csv = [
      HEADER,
      'NEW,Franco Automotors,https://francoautomotors.com/,Miami,Miami,786-847-9726,,,,,,@francoautomotors,,ES,,,,,,,,"Spanish-first site, HIGH VALUE"',
    ].join('\n')
    const rows = parseTracker(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Franco Automotors')
    expect(rows[0].instagram).toBe('@francoautomotors')
    expect(rows[0].language).toBe('ES')
    expect(rows[0].notes).toBe('Spanish-first site, HIGH VALUE')
  })

  it('strips a UTF-8 BOM and blank lines', () => {
    const csv = '﻿' + HEADER + '\nNEW,A,https://a.com,,,,,,,,,,,EN,,,,,,,,\n\n'
    expect(parseTracker(csv)).toHaveLength(1)
  })
})

describe('pickDailyBatch', () => {
  it('picks only NEW rows with a website, preserving tracker (priority) order', () => {
    const batch = pickDailyBatch({
      auto: [
        row({ name: 'First' }),
        row({ name: 'AlreadySent', status: 'SAMPLE_SENT' }),
        row({ name: 'NoSite', website: '' }),
        row({ name: 'Second' }),
        row({ name: 'Dead', status: 'DEAD' }),
      ],
      realestate: [],
      ecom: [],
    }, { auto: 2, realestate: 1, ecom: 1 })
    expect(batch.map((p) => p.row.name)).toEqual(['First', 'Second'])
  })

  it('honors the vertical mix when every vertical has supply', () => {
    const supply = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => row({ name: `${prefix}${i}` }))
    const batch = pickDailyBatch(
      { auto: supply(10, 'a'), realestate: supply(10, 'r'), ecom: supply(10, 'e') },
      { auto: 6, realestate: 2, ecom: 2 },
    )
    expect(batch).toHaveLength(10)
    expect(batch.filter((p) => p.vertical === 'auto')).toHaveLength(6)
    expect(batch.filter((p) => p.vertical === 'realestate')).toHaveLength(2)
    expect(batch.filter((p) => p.vertical === 'ecom')).toHaveLength(2)
  })

  it('backfills the quota from other verticals when one runs short', () => {
    const supply = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => row({ name: `${prefix}${i}` }))
    const batch = pickDailyBatch(
      { auto: supply(10, 'a'), realestate: supply(1, 'r'), ecom: [] },
      { auto: 6, realestate: 2, ecom: 2 },
    )
    expect(batch).toHaveLength(10)
    expect(batch.filter((p) => p.vertical === 'auto')).toHaveLength(9)
    expect(batch.filter((p) => p.vertical === 'realestate')).toHaveLength(1)
  })

  it('skips rows already marked sample_sent even if status was left NEW', () => {
    const batch = pickDailyBatch({
      auto: [row({ name: 'SentButNotUpdated', sampleSent: 'Y' }), row({ name: 'Fresh' })],
      realestate: [], ecom: [],
    }, { auto: 2, realestate: 1, ecom: 1 })
    expect(batch.map((p) => p.row.name)).toEqual(['Fresh'])
  })
})

describe('followUpsDue', () => {
  const today = new Date('2026-07-28T12:00:00Z')

  it('stages follow-ups by days since the sample, most overdue first', () => {
    const due = followUpsDue({
      auto: [
        row({ name: 'Two', status: 'SAMPLE_SENT', sampleDate: '2026-07-26' }),
        row({ name: 'Six', status: 'SAMPLE_SENT', sampleDate: '2026-07-22' }),
        row({ name: 'Twelve', status: 'SAMPLE_SENT', sampleDate: '2026-07-16' }),
        row({ name: 'Fresh', status: 'SAMPLE_SENT', sampleDate: '2026-07-28' }),
      ],
      realestate: [], ecom: [],
    }, today)
    expect(due.map((f) => `${f.row.name}:${f.stage}`)).toEqual(['Twelve:D+10', 'Six:D+5', 'Two:D+2'])
  })

  it('excludes accounts that replied and terminal statuses — those are conversations, not chases', () => {
    const due = followUpsDue({
      auto: [
        row({ name: 'Replied', status: 'SAMPLE_SENT', sampleDate: '2026-07-20', response: 'interested!' }),
        row({ name: 'NowPilot', status: 'PILOT', sampleDate: '2026-07-20' }),
        row({ name: 'Silent', status: 'SAMPLE_SENT', sampleDate: '2026-07-20' }),
      ],
      realestate: [], ecom: [],
    }, today)
    expect(due.map((f) => f.row.name)).toEqual(['Silent'])
  })

  it('writes the Spanish template for ES accounts and includes the brand name', () => {
    const due = followUpsDue({
      auto: [row({ name: 'Franco Automotors', language: 'ES', status: 'SAMPLE_SENT', sampleDate: '2026-07-22' })],
      realestate: [], ecom: [],
    }, today)
    expect(due[0].message).toContain('Franco Automotors')
    expect(due[0].message).toMatch(/piloto de \$99/)
  })

  it('ignores rows with a missing or garbage sample date rather than guessing', () => {
    const due = followUpsDue({
      auto: [
        row({ name: 'NoDate', status: 'SAMPLE_SENT' }),
        row({ name: 'BadDate', status: 'SAMPLE_SENT', sampleDate: 'soon' }),
      ],
      realestate: [], ecom: [],
    }, today)
    expect(due).toHaveLength(0)
  })
})
