"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, Sparkles, TrendingUp, CalendarClock } from "lucide-react"

interface Opportunity {
  itemId: string
  externalRef: string
  label: string
  vertical: string
  priceText: string | null
  daysInInventory: number
  score: number
  reasons: string[]
}

interface GrowthDecision {
  reason: string
  targetAudience: string
  languages: string[]
  aspectRatio: string
  salesAngle: string
  templateStrategy: string
  voiceStyle: string
  callToAction: string
  evidenceUsed: string[]
  testNext: string
  confidence: string
  variants: Array<{
    language: "en" | "es"
    hookLabel: string
    hookNarration: string
    ctaLabel: string
    ctaNarration: string
  }>
}

const VERTICALS = [
  { key: "", label: "All" },
  { key: "auto", label: "Vehicles" },
  { key: "realestate", label: "Listings" },
  { key: "ecom", label: "Products" },
]

export default function RecommendationsPage() {
  const [items, setItems] = useState<Opportunity[]>([])
  const [vertical, setVertical] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<Record<string, GrowthDecision>>({})
  const [auditIds, setAuditIds] = useState<Record<string, string>>({})
  const [deciding, setDeciding] = useState<string | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [createdCampaigns, setCreatedCampaigns] = useState<Record<string, string>>({})
  const [schedule, setSchedule] = useState({ enabled: false, cadence: "daily", emailEnabled: true, maxDecisions: 1 })
  const [scheduleSaving, setScheduleSaving] = useState(false)

  useEffect(() => {
    fetch("/api/growth-operator/schedule", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setSchedule({
        enabled: Boolean(data.schedule.enabled),
        cadence: data.schedule.cadence || "daily",
        emailEnabled: data.schedule.emailEnabled !== false,
        maxDecisions: data.schedule.maxDecisions || 1,
      }))
      .catch(() => {})
  }, [])

  const saveSchedule = async () => {
    setScheduleSaving(true)
    setError(null)
    const response = await fetch("/api/growth-operator/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schedule),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) setError(data.error || "Could not save the Growth Operator schedule.")
    setScheduleSaving(false)
  }

  const askGrowthOperator = async (itemId: string) => {
    setDeciding(itemId)
    setError(null)
    try {
      const res = await fetch("/api/growth-operator/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Gemini could not create a campaign decision.")
      setDecisions((current) => ({ ...current, [itemId]: data.decision }))
      setAuditIds((current) => ({ ...current, [itemId]: data.auditId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gemini could not create a campaign decision.")
    } finally {
      setDeciding(null)
    }
  }

  const generateCampaign = async (item: Opportunity) => {
    const decision = decisions[item.itemId]
    const auditId = auditIds[item.itemId]
    if (!decision || !auditId) return
    setGenerating(item.itemId)
    setError(null)
    try {
      const allVariants: any[] = []
      for (const language of decision.languages) {
        const languageVariants = decision.variants.filter((variant) => variant.language === language)
        const firstCta = languageVariants[0]
        const response = await fetch("/api/campaigns/variations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: `${item.label}. ${decision.salesAngle}. Evidence: ${decision.evidenceUsed.join("; ")}.`,
            duration: 25,
            renderQuality: "full",
            addOns: ["voiceover", "subtitles", "music"],
            axes: {
              hooks: languageVariants.map((variant) => ({
                label: variant.hookLabel,
                narration: variant.hookNarration,
              })),
              ctas: firstCta ? [{ label: firstCta.ctaLabel, narration: firstCta.ctaNarration }] : [],
              aspectRatios: [decision.aspectRatio],
              languages: [language],
            },
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || `Could not generate ${language.toUpperCase()} variants.`)
        allVariants.push(...(Array.isArray(data.variants) ? data.variants : []))
      }
      const started = allVariants.filter((variant) => variant.videoId)
      if (started.length === 0) throw new Error("No campaign variants could start rendering.")
      const persist = await fetch("/api/ad-studio/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${item.label} Growth Operator campaign`,
          brief: decision.reason,
          platform: decision.aspectRatio === "16:9" ? "youtube" : "reels",
          aiDecisionId: auditId,
          creatives: started.map((variant) => ({
            videoId: variant.videoId,
            label: variant.label,
            hook: variant.axes?.hook,
            cta: variant.axes?.cta,
            aspect: variant.aspectRatio,
            recommendationReason: decision.reason,
            expectedResult: decision.testNext,
          })),
        }),
      })
      const saved = await persist.json().catch(() => ({}))
      if (!persist.ok) throw new Error(saved.error || "Could not save the campaign.")
      setCreatedCampaigns((current) => ({ ...current, [item.itemId]: saved.campaignId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the campaign.")
    } finally {
      setGenerating(null)
    }
  }

  useEffect(() => {
    setIsLoading(true)
    setError(null)
    const qs = vertical ? `?vertical=${vertical}` : ""
    fetch(`/api/inventory/recommendations${qs}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to load recommendations")
        return res.json()
      })
      .then((data) => setItems(data.recommendations || []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load recommendations"))
      .finally(() => setIsLoading(false))
  }, [vertical])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">What to promote next</h1>
        <p className="text-muted-foreground">
          Scored from your own inventory history — days listed, whether it has a recent video, and whether
          its price changed since the last one. Import at least once with a feed URL to build history; this
          list gets smarter every time you re-import.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><CalendarClock className="h-5 w-5" /> Scheduled Growth Operator</CardTitle>
          <CardDescription>
            Explicit opt-in. ForgeVid may prepare recommendations and notify you; it never generates campaigns, publishes, or messages prospects automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={schedule.enabled} onCheckedChange={(checked) => setSchedule({ ...schedule, enabled: checked === true })} />
            Enable scheduled analysis
          </label>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={schedule.cadence} onChange={(event) => setSchedule({ ...schedule, cadence: event.target.value })}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option>
          </select>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={schedule.maxDecisions} onChange={(event) => setSchedule({ ...schedule, maxDecisions: Number(event.target.value) })}>
            <option value={1}>Top 1</option><option value={2}>Top 2</option><option value={3}>Top 3</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={schedule.emailEnabled} onCheckedChange={(checked) => setSchedule({ ...schedule, emailEnabled: checked === true })} />
            Email me when ready
          </label>
          <Button onClick={() => void saveSchedule()} disabled={scheduleSaving}>
            {scheduleSaving && <Loader2 className="h-4 w-4 animate-spin" />} Save schedule
          </Button>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        {VERTICALS.map((v) => (
          <button
            key={v.key}
            onClick={() => setVertical(v.key)}
            className={`rounded-md px-3 py-1.5 text-sm ${vertical === v.key ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No recommendations yet. Import your inventory via a feed URL (Vehicles, Listings, or Products
            batch) at least once — recommendations need at least one snapshot to score against, and get
            sharper each time you re-import as price/video history builds up.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <Card key={item.itemId}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="text-muted-foreground">#{i + 1}</span>
                    {item.label}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{item.vertical}</Badge>
                    <Badge className="gap-1">
                      <TrendingUp className="h-3 w-3" /> {item.score}
                    </Badge>
                  </div>
                </div>
                <CardDescription>
                  {item.priceText || "no price on file"} · {item.daysInInventory} day{item.daysInInventory === 1 ? "" : "s"} tracked
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {item.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <div className="mt-4 border-t pt-4">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void askGrowthOperator(item.itemId)}
                    disabled={deciding === item.itemId}
                  >
                    {deciding === item.itemId
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Sparkles className="h-4 w-4" />}
                    Ask Gemini for campaign decision
                  </Button>
                </div>
                {decisions[item.itemId] && (
                  <div className="mt-4 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Badge>{decisions[item.itemId].confidence} confidence</Badge>
                      <Badge variant="outline">{decisions[item.itemId].aspectRatio}</Badge>
                      {decisions[item.itemId].languages.map((language) => (
                        <Badge key={language} variant="secondary">{language.toUpperCase()}</Badge>
                      ))}
                    </div>
                    <p><strong>Why:</strong> {decisions[item.itemId].reason}</p>
                    <p><strong>Audience:</strong> {decisions[item.itemId].targetAudience}</p>
                    <p><strong>Sales angle:</strong> {decisions[item.itemId].salesAngle}</p>
                    <p><strong>Template:</strong> {decisions[item.itemId].templateStrategy}</p>
                    <p><strong>Voice:</strong> {decisions[item.itemId].voiceStyle}</p>
                    <p><strong>CTA:</strong> {decisions[item.itemId].callToAction}</p>
                    <p><strong>Next test:</strong> {decisions[item.itemId].testNext}</p>
                    <p className="text-xs text-muted-foreground">
                      Evidence: {decisions[item.itemId].evidenceUsed.join(" · ")}
                    </p>
                    {createdCampaigns[item.itemId] ? (
                      <Button asChild size="sm">
                        <a href="/dashboard/approvals">Review generated variants</a>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => void generateCampaign(item)}
                        disabled={generating === item.itemId}
                      >
                        {generating === item.itemId
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Sparkles className="h-4 w-4" />}
                        Generate campaign
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
