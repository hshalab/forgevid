"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

interface Discount { id: string; code: string; percentOff?: number | null; amountOffCents?: number | null; redemptions: number; maxRedemptions?: number | null; active: boolean; expiresAt?: string | null }

export default function AdminDiscountsPage() {
  const [rows, setRows] = useState<Discount[]>([])
  const [form, setForm] = useState({ code: "", percentOff: "10", maxRedemptions: "", expiresAt: "" })
  const [error, setError] = useState("")
  const load = () => fetch("/api/admin/discounts", { cache: "no-store" }).then(async (response) => {
    const data = await response.json()
    if (!response.ok) throw new Error(data.error)
    setRows(data.discounts || [])
  }).catch((reason) => setError(reason.message || "Could not load discounts."))
  useEffect(() => { void load() }, [])

  const create = async () => {
    setError("")
    const response = await fetch("/api/admin/discounts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.code, percentOff: Number(form.percentOff),
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) setError(data.error || "Could not create discount.")
    else { setForm({ code: "", percentOff: "10", maxRedemptions: "", expiresAt: "" }); await load() }
  }

  return <div className="space-y-6 p-6">
    <div><h1 className="text-3xl font-bold">Discount codes</h1><p className="text-muted-foreground">Separate from referrals. Codes create a one-time Stripe coupon and are enforced server-side.</p></div>
    {error && <div className="rounded-md border border-red-500/40 p-3 text-red-400">{error}</div>}
    <Card><CardHeader><CardTitle>Create code</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-4">
      <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="LAUNCH20" />
      <Input type="number" min={1} max={100} value={form.percentOff} onChange={(event) => setForm({ ...form, percentOff: event.target.value })} placeholder="Percent off" />
      <Input type="number" min={1} value={form.maxRedemptions} onChange={(event) => setForm({ ...form, maxRedemptions: event.target.value })} placeholder="Max redemptions" />
      <Input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} />
      <Button onClick={() => void create()} disabled={!form.code}>Create Stripe coupon</Button>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Codes</CardTitle></CardHeader><CardContent className="space-y-2">
      {rows.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between rounded-md border p-3"><div><strong>{row.code}</strong> · {row.percentOff ? `${row.percentOff}%` : `$${((row.amountOffCents || 0) / 100).toFixed(2)}`} off · {row.redemptions}/{row.maxRedemptions ?? "∞"} used</div><span>{row.active ? "Active" : "Disabled"}</span></div>)}
    </CardContent></Card>
  </div>
}
