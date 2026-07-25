"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, TrendingUp } from "lucide-react"

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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
