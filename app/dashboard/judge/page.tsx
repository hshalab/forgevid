"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react"

const steps = [
  { title: "1. Inspect scored inventory", detail: "See why each deterministic demo item is recommended.", href: "/dashboard/recommendations" },
  { title: "2. Ask Gemini for a decision", detail: "Generate grounded EN/ES hooks and review the evidence used.", href: "/dashboard/recommendations" },
  { title: "3. Review the approval gate", detail: "Inspect rights confirmation, revision control, and the no-autopublish promise.", href: "/dashboard/approvals" },
  { title: "4. Inspect measured impact", detail: "See observed views/leads, customer-recorded outcomes, and explicit savings assumptions.", href: "/dashboard/analytics" },
]

export default function JudgeTourPage() {
  const [resetting, setResetting] = useState(false)
  const [message, setMessage] = useState("")
  const reset = async () => {
    if (!window.confirm("Reset only the judge demo workspace to its deterministic sample data?")) return
    setResetting(true)
    const response = await fetch("/api/judge/reset", { method: "POST" })
    const data = await response.json().catch(() => ({}))
    setMessage(data.message || data.error || "Reset failed.")
    setResetting(false)
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Judge guided tour</h1>
        <p className="text-muted-foreground">A three-minute, human-gated path through the Growth Operator.</p>
      </div>
      <Card className="border-cyan-500/40">
        <CardHeader><CardTitle>Safety invariant</CardTitle></CardHeader>
        <CardContent>ForgeVid never publishes or messages prospects autonomously. Every campaign requires content-rights confirmation and approval of the exact revision.</CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {steps.map((step) => (
          <Card key={step.title}>
            <CardHeader><CardTitle className="flex gap-2"><CheckCircle2 className="h-5 w-5 text-green-500" />{step.title}</CardTitle><CardDescription>{step.detail}</CardDescription></CardHeader>
            <CardContent><Button asChild><Link href={step.href}>Open step</Link></Button></CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Deterministic reset</CardTitle><CardDescription>Deletes only judge-account demo activity and restores three synthetic inventory items. Genuine customer and hackathon evidence is untouched.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={() => void reset()} disabled={resetting}>
            {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reset judge workspace
          </Button>
          {message && <p className="text-sm">{message}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
