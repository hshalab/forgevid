import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getHackathonEvidence } from '@/lib/hackathon-evidence'

export const dynamic = 'force-dynamic'

export default async function HackathonEvidencePage() {
  const evidence = await getHackathonEvidence()
  const s = evidence.summary
  const activation = s.users ? Math.round((s.activatedUsers / s.users) * 100) : 0
  const retention = s.activatedUsers ? Math.round((s.repeatUsers / s.activatedUsers) * 100) : 0
  const cards = [
    ['Hackathon users', s.users],
    ['Activated users', `${s.activatedUsers} (${activation}%)`],
    ['Repeat users', `${s.repeatUsers} (${retention}%)`],
    ['Videos / completed', `${s.videos} / ${s.completedVideos}`],
    ['Completed exports', s.exports],
    ['Verified revenue (self-serve)', `$${s.revenueUsd.toFixed(2)}`],
    ['Recorded AI cost', `$${s.aiCostUsd.toFixed(2)}`],
    ['Consented testimonials', `${s.publicTestimonials} / ${s.testimonials}`],
  ]
  const outboundCards = [
    ['Outbound leads', s.outboundLeads],
    ['Samples sent', s.outboundSampleSent],
    ['Converted (arms-length)', s.outboundConverted],
    ['Outbound revenue (arms-length)', `$${s.outboundRevenueUsd.toFixed(2)}`],
  ]
  const relatedPartyTotal = s.relatedPartyRevenueUsd + s.outboundRelatedPartyRevenueUsd
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Hackathon evidence</h1>
          <p className="text-muted-foreground">Production records since May 19, 2026. No inferred revenue or fabricated users.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/admin/leads">Manage leads</Link></Button>
          <Button asChild variant="outline"><Link href="/admin/operating-costs">Manage costs</Link></Button>
          <Button asChild><Link href="/api/admin/hackathon-evidence/csv">Export CSV</Link></Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <Card key={String(label)}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription></CardHeader><CardContent className="text-2xl font-bold">{value}</CardContent></Card>
        ))}
      </div>
      <div>
        <h2 className="mb-3 text-lg font-semibold">Outbound pipeline (dealers, realtors, e-commerce)</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {outboundCards.map(([label, value]) => (
            <Card key={String(label)}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription></CardHeader><CardContent className="text-2xl font-bold">{value}</CardContent></Card>
          ))}
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-lg font-semibold">Costs (hand-entered — see Manage costs)</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardDescription>Total operating cost</CardDescription></CardHeader><CardContent className="text-2xl font-bold">${s.operatingCostUsd.toFixed(2)}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Of which marketing spend</CardDescription></CardHeader><CardContent className="text-2xl font-bold">${s.marketingSpendUsd.toFixed(2)}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Recorded AI cost (auto)</CardDescription></CardHeader><CardContent className="text-2xl font-bold">${s.aiCostUsd.toFixed(2)}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Total cost (operating + AI)</CardDescription></CardHeader><CardContent className="text-2xl font-bold">${(s.operatingCostUsd + s.aiCostUsd).toFixed(2)}</CardContent></Card>
        </div>
      </div>
      {relatedPartyTotal > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-2"><CardDescription>Related-party revenue (excluded above — not arms-length)</CardDescription></CardHeader>
          <CardContent className="text-2xl font-bold">${relatedPartyTotal.toFixed(2)}</CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Evidence definitions</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Activated: created at least one video. Repeat: created more than one video. Self-serve revenue: succeeded Payment rows with `isRelatedParty = false`. Outbound revenue: `Lead.revenueCents` where `isRelatedParty = false` and a conversion date is set — a separate funnel because some pilots are paid outside Stripe (cash, Zelle, invoice). AI cost: recorded AIGeneration cost only, automatic. Operating cost: hand-entered via Manage costs (hosting, contractor, tooling, marketing spend) — never inferred or auto-charged.</p>
          <p>Related-party (friends/family/team) revenue is flagged per-row at entry time, not inferred after the fact, and is always reported separately from the two totals above.</p>
          <p>Public testimonials include only feedback whose submitter explicitly checked public-use consent.</p>
        </CardContent>
      </Card>
    </div>
  )
}
