"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BarChart3, Play, CheckCircle2, Loader2, ArrowUpRight, Timer, Film } from "lucide-react"
import { useGrowthLocale } from "@/hooks/use-growth-locale"

interface Analytics {
  summary: {
    total: number
    thisMonth: number
    completed: number
    inProgress: number
    failed: number
    completionRate: number
    totalMinutes: number
    avgSeconds: number
  }
  usage: { plan: string; thisMonth: number; videoLimit: number }
  monthly: { month: string; videos: number }[]
  value: {
    completedVideos: number
    estimatedHoursSaved: number
    estimatedCostSavedUsd: number
    assumptions: { minutesPerTraditionalVideo: number; agencyCostPerVideoUsd: number; label: string }
  }
  impact: {
    creatives: { id: string; label: string; campaignId: string }[]
    landingViews: number
    capturedLeads: number
    conversionRatePct: number
    downstreamConversions: number
    qualifiedLeads: number
    appointments: number
    sales: number
    retained: number
    attributedRevenueCents: number
    marketingSpendCents: number
    costPerLeadCents: number | null
    currency: string
    recentConversions: Array<{
      id: string
      creativeId: string
      kind: string
      source: string
      contactRef: string | null
      revenueCents: number | null
      occurredAt: string
    }>
  }
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

export default function AnalyticsPage() {
  const { t } = useGrowthLocale()
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [importMessage, setImportMessage] = useState("")
  const [conversion, setConversion] = useState({ creativeId: "", kind: "qualified_lead", revenue: "", contactRef: "" })

  useEffect(() => {
    fetch("/api/user/analytics")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
        <Loader2 className="h-5 w-5 animate-spin" /> {t("loading")}
      </div>
    )
  }
  if (!data) {
    return <div className="text-muted-foreground py-16 text-center">Couldn't load analytics right now.</div>
  }

  const s = data.summary
  const usedPct = data.usage.videoLimit > 0 ? Math.min(100, Math.round((data.usage.thisMonth / data.usage.videoLimit) * 100)) : 0
  const maxMonthly = Math.max(1, ...data.monthly.map((m) => m.videos))
  const avgLen = s.avgSeconds > 0 ? `${Math.floor(s.avgSeconds / 60)}:${String(s.avgSeconds % 60).padStart(2, "0")}` : "—"

  const saveAssumptions = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    const response = await fetch("/api/user/impact-assumptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        minutesPerTraditionalVideo: Number(form.get("minutes")),
        agencyCostPerVideoCents: Math.round(Number(form.get("agencyCost")) * 100),
      }),
    })
    if (response.ok) window.location.reload()
    else setSaving(false)
  }

  const addConversion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    const response = await fetch("/api/growth-operator/conversions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creativeId: conversion.creativeId,
        kind: conversion.kind,
        contactRef: conversion.contactRef,
        revenueCents: conversion.revenue ? Math.round(Number(conversion.revenue) * 100) : null,
        occurredAt: new Date().toISOString(),
      }),
    })
    if (response.ok) window.location.reload()
    else setSaving(false)
  }

  const importConversions = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem("conversionCsv") as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    setSaving(true)
    const response = await fetch("/api/growth-operator/conversions/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: await file.text(),
    })
    const result = await response.json().catch(() => ({}))
    setImportMessage(response.ok ? `Imported ${result.imported}; skipped ${result.skipped}.` : result.error || "Import failed.")
    setSaving(false)
    if (response.ok) window.location.reload()
  }

  const cards = [
    { label: "Total videos", value: s.total, icon: Film },
    { label: "This month", value: s.thisMonth, icon: Play },
    { label: "Completed", value: s.completed, icon: CheckCircle2 },
    { label: "Completion rate", value: `${s.completionRate}%`, icon: BarChart3 },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("analyticsTitle")}</h1>
        <p className="text-muted-foreground">Your real video activity, straight from your library.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{c.label}</span>
                <c.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-3xl font-bold mt-2 tabular-nums">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Play className="h-5 w-5" /> This month&apos;s usage</CardTitle>
            <CardDescription className="capitalize">{data.usage.plan} plan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span>Videos generated</span>
              <span className="font-medium tabular-nums">{data.usage.thisMonth} / {data.usage.videoLimit}</span>
            </div>
            <Progress value={usedPct} />
            {data.usage.thisMonth >= data.usage.videoLimit && (
              <p className="text-xs text-orange-400">You&apos;ve reached this month&apos;s limit.</p>
            )}
            <Link href="/pricing">
              <Button variant="outline" className="w-full bg-transparent mt-2">
                <ArrowUpRight className="mr-2 h-4 w-4" /> Change plan
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Timer className="h-5 w-5" /> Library</CardTitle>
            <CardDescription>Across all your videos</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Total minutes" value={s.totalMinutes} />
              <Stat label="Avg length" value={avgLen} />
              <Stat label="In progress" value={s.inProgress} />
              <Stat label="Failed" value={s.failed} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Estimated business value</CardTitle>
          <CardDescription>Illustrative savings based on completed videos—not guaranteed results.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Stat label="Completed videos" value={data.value.completedVideos} />
          <Stat label="Estimated hours saved" value={data.value.estimatedHoursSaved} />
          <Stat label="Estimated production cost avoided" value={`$${data.value.estimatedCostSavedUsd.toLocaleString()}`} />
          <p className="text-xs text-muted-foreground sm:col-span-3">
            Assumption: {data.value.assumptions.minutesPerTraditionalVideo} minutes and ${data.value.assumptions.agencyCostPerVideoUsd} per conventional video. Adjust this comparison to your workflow.
          </p>
          <form onSubmit={saveAssumptions} className="sm:col-span-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
            <div><Label htmlFor="minutes">Minutes per conventional video</Label><Input id="minutes" name="minutes" type="number" min="1" defaultValue={data.value.assumptions.minutesPerTraditionalVideo} /></div>
            <div><Label htmlFor="agencyCost">Conventional cost per video (USD)</Label><Input id="agencyCost" name="agencyCost" type="number" min="0" step="0.01" defaultValue={data.value.assumptions.agencyCostPerVideoUsd} /></div>
            <Button type="submit" disabled={saving}>Save assumptions</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("impactLedger")}</CardTitle>
          <CardDescription>Observed landing activity and customer-recorded outcomes. ForgeVid never infers a sale or revenue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Landing views" value={data.impact.landingViews} />
            <Stat label="Captured leads" value={data.impact.capturedLeads} />
            <Stat label="Lead rate" value={`${data.impact.conversionRatePct}%`} />
            <Stat label="Downstream outcomes" value={data.impact.downstreamConversions} />
            <Stat label="Attributed revenue" value={`$${(data.impact.attributedRevenueCents / 100).toFixed(2)}`} />
            <Stat label="Cost per lead" value={data.impact.costPerLeadCents == null ? "—" : `$${(data.impact.costPerLeadCents / 100).toFixed(2)}`} />
          </div>
          {data.impact.creatives.length > 0 && (
            <>
            <form onSubmit={addConversion} className="grid gap-3 md:grid-cols-5 items-end border rounded-lg p-4">
              <div>
                <Label htmlFor="creative">Approved creative</Label>
                <select id="creative" required className="h-10 w-full rounded-md border bg-background px-3" value={conversion.creativeId} onChange={(event) => setConversion({ ...conversion, creativeId: event.target.value })}>
                  <option value="">Choose creative</option>
                  {data.impact.creatives.map((creative) => <option key={creative.id} value={creative.id}>{creative.label}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="kind">Outcome</Label>
                <select id="kind" className="h-10 w-full rounded-md border bg-background px-3" value={conversion.kind} onChange={(event) => setConversion({ ...conversion, kind: event.target.value })}>
                  <option value="qualified_lead">Qualified lead</option><option value="appointment">Appointment</option><option value="sale">Sale</option><option value="retained">Retained</option>
                </select>
              </div>
              <div><Label htmlFor="contactRef">Contact/order reference</Label><Input id="contactRef" value={conversion.contactRef} onChange={(event) => setConversion({ ...conversion, contactRef: event.target.value })} /></div>
              <div><Label htmlFor="revenue">Revenue (USD, optional)</Label><Input id="revenue" type="number" min="0" step="0.01" value={conversion.revenue} onChange={(event) => setConversion({ ...conversion, revenue: event.target.value })} /></div>
              <Button type="submit" disabled={saving}>Record outcome</Button>
            </form>
            <form onSubmit={importConversions} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
              <div className="min-w-72 flex-1">
                <Label htmlFor="conversionCsv">Import CRM outcomes (CSV)</Label>
                <Input id="conversionCsv" name="conversionCsv" type="file" accept=".csv,text/csv" />
              </div>
              <Button type="submit" variant="outline" disabled={saving}>Import reviewed CSV</Button>
              <p className="w-full text-xs text-muted-foreground">
                Required columns: creativeId, kind, occurredAt, externalId. Optional: revenueUsd, contactRef, notes. Imports never publish or message anyone.
              </p>
              {importMessage && <p className="w-full text-sm">{importMessage}</p>}
            </form>
            </>
          )}
          <div className="space-y-2">
            {data.impact.recentConversions.length === 0 ? <p className="text-sm text-muted-foreground">No downstream outcomes recorded yet.</p> : data.impact.recentConversions.slice(0, 10).map((item) => (
              <div key={item.id} className="flex flex-wrap justify-between gap-2 border-b py-2 text-sm">
                <span className="capitalize">{item.kind.replace("_", " ")} · {item.contactRef || "No reference"} · {item.source}</span>
                <span>{item.revenueCents == null ? "Revenue not recorded" : `$${(item.revenueCents / 100).toFixed(2)}`} · {new Date(item.occurredAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Monthly trends</CardTitle>
          <CardDescription>Videos created over the last 6 months</CardDescription>
        </CardHeader>
        <CardContent>
          {s.total === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No videos yet — your trends will appear here.</p>
          ) : (
            <div className="flex items-end justify-between gap-3 h-40">
              {data.monthly.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-2 h-full">
                  <span className="text-xs font-medium tabular-nums">{m.videos}</span>
                  <div className="w-full rounded-t bg-primary/80" style={{ height: `${Math.max(4, (m.videos / maxMonthly) * 100)}%` }} />
                  <span className="text-xs text-muted-foreground">{m.month}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
