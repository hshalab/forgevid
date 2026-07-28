jest.mock('@/lib/prisma', () => ({
  prisma: { template: { findMany: jest.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { recommendTemplates } from '@/lib/template-recommendations'

const mockedTemplate = prisma.template as jest.Mocked<typeof prisma.template>

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1', name: 'Template', category: 'MARKETING', thumbnail: '/t.jpg', aspectRatio: '16:9',
    usageCount: 0, averageRating: null, totalRatings: 0, favoriteCount: 0, analytics: [],
    ...overrides,
  }
}

describe('template-recommendations', () => {
  beforeEach(() => jest.clearAllMocks())

  it('gives a template with no evidence a neutral prior and says so', async () => {
    mockedTemplate.findMany.mockResolvedValue([template()] as any)
    const [rec] = await recommendTemplates()
    expect(rec.evidenceCount).toBe(0)
    expect(rec.reason).toContain('No usage evidence')
  })

  it('ranks a well-used, well-rated template above an unproven one', async () => {
    mockedTemplate.findMany.mockResolvedValue([
      template({ id: 'unproven' }),
      template({
        id: 'proven', usageCount: 40, averageRating: 4.6, totalRatings: 12,
        analytics: [{ views: 200, clicks: 80, uses: 30 }],
      }),
    ] as any)
    const recs = await recommendTemplates()
    expect(recs[0].templateId).toBe('proven')
    expect(recs[0].evidenceCount).toBeGreaterThan(0)
    expect(recs[0].reason).toContain('30 recent uses')
  })

  it('filters to approved public templates of the requested category', async () => {
    mockedTemplate.findMany.mockResolvedValue([] as any)
    await recommendTemplates('BUSINESS' as any, 3)
    expect(mockedTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isPublic: true, moderationStatus: 'approved', category: 'BUSINESS' },
    }))
  })

  it('uses a neutral engagement prior below 20 views instead of trusting 2 clicks on 3 views', async () => {
    mockedTemplate.findMany.mockResolvedValue([
      template({ id: 'tiny', analytics: [{ views: 3, clicks: 3, uses: 0 }] }),
      template({ id: 'real', analytics: [{ views: 100, clicks: 60, uses: 0 }] }),
    ] as any)
    const recs = await recommendTemplates()
    // 100%-CTR-on-3-views must NOT beat 60%-CTR-on-100-views.
    expect(recs[0].templateId).toBe('real')
  })
})
