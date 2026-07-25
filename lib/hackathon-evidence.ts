import { prisma } from './prisma'

export const HACKATHON_START = new Date('2026-05-19T17:00:00.000Z')

export async function getHackathonEvidence() {
  const users = await prisma.user.findMany({
    where: { createdAt: { gte: HACKATHON_START }, status: { not: 'DELETED' } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, email: true, name: true, createdAt: true,
      videos: { select: { id: true, status: true, createdAt: true, exports: { where: { status: 'COMPLETED' }, select: { id: true } } } },
      payments: { where: { status: 'SUCCEEDED', createdAt: { gte: HACKATHON_START } }, select: { amount: true, createdAt: true, description: true, isRelatedParty: true } },
      usageRecords: { where: { timestamp: { gte: HACKATHON_START } }, select: { action: true, quantity: true, cost: true, metadata: true, timestamp: true } },
      aiGenerations: { where: { createdAt: { gte: HACKATHON_START } }, select: { cost: true } },
    },
  })

  const rows = users.map((user) => {
    const completed = user.videos.filter((video) => video.status === 'COMPLETED').length
    const exports = user.videos.reduce((sum, video) => sum + video.exports.length, 0)
    const armsLengthPayments = user.payments.filter((payment) => !payment.isRelatedParty)
    const relatedPartyPayments = user.payments.filter((payment) => payment.isRelatedParty)
    const revenue = armsLengthPayments.reduce((sum, payment) => sum + Number(payment.amount), 0)
    const relatedPartyRevenue = relatedPartyPayments.reduce((sum, payment) => sum + Number(payment.amount), 0)
    const aiCost = user.aiGenerations.reduce((sum, generation) => sum + Number(generation.cost || 0), 0)
    const testimonial = user.usageRecords.find((event) => event.action === 'testimonial_submitted')
    let publicTestimonial = false
    try { publicTestimonial = JSON.parse(testimonial?.metadata || '{}').allowPublicUse === true } catch {}
    return {
      userId: user.id,
      email: user.email,
      name: user.name || '',
      registeredAt: user.createdAt,
      videos: user.videos.length,
      completed,
      exports,
      activated: user.videos.length > 0,
      repeatUser: user.videos.length > 1,
      revenue,
      relatedPartyRevenue,
      aiCost,
      testimonial: Boolean(testimonial),
      publicTestimonial,
    }
  })

  // Outbound/pilot pipeline (dealers, realtors, ecom) — a separate funnel from
  // self-serve signups above; some leads convert to a Payment row (Stripe),
  // others (cash/Zelle/invoice) exist only here. isRelatedParty excludes
  // friends/family pilots from judged revenue by construction.
  const leads = await prisma.lead.findMany({
    where: { createdAt: { gte: HACKATHON_START } },
    select: {
      id: true, vertical: true, businessName: true, status: true, isRelatedParty: true,
      revenueCents: true, testimonialConsent: true, sampleSentAt: true, convertedAt: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  const armsLengthLeads = leads.filter((lead) => !lead.isRelatedParty)
  const outboundRevenueUsd = armsLengthLeads.reduce((sum, lead) => sum + (lead.revenueCents ?? 0), 0) / 100
  const outboundRelatedPartyRevenueUsd = leads
    .filter((lead) => lead.isRelatedParty)
    .reduce((sum, lead) => sum + (lead.revenueCents ?? 0), 0) / 100

  // Hand-entered operating costs (hosting, contractors, tooling, paid
  // marketing) — separate from AIGeneration.cost (API cost only), so the
  // dashboard can show something closer to a real P&L instead of just
  // inference spend.
  const operatingCosts = await prisma.operatingCost.findMany({
    where: { incurredOn: { gte: HACKATHON_START } },
    orderBy: { incurredOn: 'asc' },
  })
  const operatingCostUsd = operatingCosts.reduce((sum, c) => sum + c.amountCents, 0) / 100
  const marketingSpendUsd = operatingCosts
    .filter((c) => c.category === 'marketing_spend')
    .reduce((sum, c) => sum + c.amountCents, 0) / 100

  return {
    generatedAt: new Date(),
    start: HACKATHON_START,
    rows,
    leads,
    operatingCosts,
    summary: {
      users: rows.length,
      activatedUsers: rows.filter((row) => row.activated).length,
      repeatUsers: rows.filter((row) => row.repeatUser).length,
      videos: rows.reduce((sum, row) => sum + row.videos, 0),
      completedVideos: rows.reduce((sum, row) => sum + row.completed, 0),
      exports: rows.reduce((sum, row) => sum + row.exports, 0),
      revenueUsd: rows.reduce((sum, row) => sum + row.revenue, 0),
      relatedPartyRevenueUsd: rows.reduce((sum, row) => sum + row.relatedPartyRevenue, 0),
      aiCostUsd: rows.reduce((sum, row) => sum + row.aiCost, 0),
      testimonials: rows.filter((row) => row.testimonial).length,
      publicTestimonials: rows.filter((row) => row.publicTestimonial).length,
      outboundLeads: leads.length,
      outboundSampleSent: leads.filter((l) => l.sampleSentAt || l.status !== 'NEW').length,
      outboundConverted: armsLengthLeads.filter((l) => l.convertedAt).length,
      outboundRevenueUsd,
      outboundRelatedPartyRevenueUsd,
      operatingCostUsd,
      marketingSpendUsd,
    },
  }
}
