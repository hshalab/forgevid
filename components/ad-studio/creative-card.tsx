"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Star, VideoOff } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CreativeRow } from "./types"

// REVIEW_REQUIRED is terminal for polling: the render is done but held for
// the owner's review in the AI Studio — keeping the interval running would
// poll forever waiting for a COMPLETED that needs a human first.
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED", "REVIEW_REQUIRED"])
const POLL_MS = 3000

interface JobStatusResponse {
  status: string
  percent?: number
  videoUrl?: string | null
  thumbnail?: string | null
  error?: string | null
}

/**
 * One ad variant: the video (real, rendering, or a placeholder), its hook/CTA,
 * a winner toggle, and an inline ROAS input. Self-contained — it polls
 * /api/ai/jobs/{videoId} on its own while a render is in flight, so any grid
 * that renders a list of creatives gets live updates for free.
 */
export function CreativeCard({
  creative,
  onUpdated,
}: {
  creative: CreativeRow
  onUpdated?: (id: string, patch: { isWinner?: boolean; roas?: number | null }) => void
}) {
  const [url, setUrl] = useState(creative.url ?? null)
  const [thumbnail, setThumbnail] = useState(creative.thumbnail ?? null)
  const [status, setStatus] = useState(creative.status ?? null)
  const [percent, setPercent] = useState(0)
  const [jobError, setJobError] = useState<string | null>(null)

  const [isWinner, setIsWinner] = useState(creative.isWinner)
  const [winnerSaving, setWinnerSaving] = useState(false)

  const [roasInput, setRoasInput] = useState(creative.roas != null ? String(creative.roas) : "")
  const [roasSaving, setRoasSaving] = useState(false)
  const [roasErr, setRoasErr] = useState(false)

  // Re-sync local view state whenever the caller hands us a fresher row
  // (e.g. after a campaign refetch).
  useEffect(() => {
    setUrl(creative.url ?? null)
    setThumbnail(creative.thumbnail ?? null)
    setStatus(creative.status ?? null)
    setIsWinner(creative.isWinner)
    setRoasInput(creative.roas != null ? String(creative.roas) : "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creative.id, creative.url, creative.status, creative.thumbnail, creative.isWinner, creative.roas])

  const isTerminal = status ? TERMINAL_STATUSES.has(status) : false
  const rendering = !url && !!creative.videoId && !isTerminal
  const failed = !url && (status === "FAILED" || status === "CANCELLED")

  const videoIdRef = useRef(creative.videoId)
  videoIdRef.current = creative.videoId

  useEffect(() => {
    if (!rendering || !creative.videoId) return
    let cancelled = false
    const videoId = creative.videoId

    const poll = async () => {
      try {
        const res = await fetch(`/api/ai/jobs/${videoId}`)
        if (cancelled) return
        const data: JobStatusResponse = await res.json().catch(() => ({ status: "" }))
        if (!res.ok) return
        setStatus(data.status)
        if (typeof data.percent === "number") setPercent(data.percent)
        if (data.thumbnail) setThumbnail(data.thumbnail)
        if (data.videoUrl) setUrl(data.videoUrl)
        if (data.status === "FAILED") setJobError(data.error || "Generation failed")
      } catch {
        // transient network error — keep polling
      }
    }

    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [rendering, creative.videoId])

  const toggleWinner = async () => {
    const next = !isWinner
    setIsWinner(next)
    setWinnerSaving(true)
    try {
      const res = await fetch(`/api/ad-studio/creatives/${creative.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isWinner: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Could not update")
      onUpdated?.(creative.id, { isWinner: next })
    } catch {
      setIsWinner(!next)
    } finally {
      setWinnerSaving(false)
    }
  }

  const saveRoas = async () => {
    const trimmed = roasInput.trim().replace(/x$/i, "").trim()
    const value = trimmed === "" ? null : Number(trimmed)
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1000)) {
      setRoasErr(true)
      return
    }
    setRoasErr(false)
    setRoasSaving(true)
    try {
      const res = await fetch(`/api/ad-studio/creatives/${creative.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roas: value }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Could not update")
      onUpdated?.(creative.id, { roas: value })
    } catch {
      setRoasErr(true)
    } finally {
      setRoasSaving(false)
    }
  }

  return (
    <Card className={cn("overflow-hidden", isWinner && "border-yellow-500/70 ring-1 ring-yellow-500/30")}>
      <div className="relative aspect-video bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
        {url ? (
          <video controls src={url} poster={thumbnail ?? undefined} className="w-full h-full object-contain bg-black" />
        ) : rendering ? (
          <div className="flex flex-col items-center gap-2 text-gray-300 text-sm">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Rendering{percent > 0 ? ` — ${percent}%` : "…"}</span>
          </div>
        ) : failed ? (
          <div className="flex flex-col items-center gap-2 text-red-400 text-sm px-4 text-center">
            <VideoOff className="h-6 w-6" />
            <span>{jobError || "This variant failed to render."}</span>
          </div>
        ) : status === "REVIEW_REQUIRED" ? (
          <div className="flex flex-col items-center gap-2 text-amber-400 text-sm px-4 text-center">
            <VideoOff className="h-6 w-6" />
            <span>Held for your review — accept or reject it in the AI Studio.</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-gray-500 text-sm">
            <VideoOff className="h-6 w-6" />
            <span>No video</span>
          </div>
        )}
        {isWinner && (
          <Badge className="absolute top-2 right-2 border-transparent bg-yellow-500 text-black">
            <Star className="h-3 w-3 fill-current" /> Winner
          </Badge>
        )}
      </div>

      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-medium line-clamp-2" title={creative.label}>
          {creative.label}
        </p>
        {creative.evidence && (
          <div className="rounded-md border p-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="mr-2 capitalize">{creative.evidence.strength}</Badge>
            {creative.evidence.views} views · {creative.evidence.leads} leads · {creative.evidence.downstreamConversions} outcomes
          </div>
        )}
        {(creative.hook || creative.cta) && (
          <div className="flex flex-wrap gap-1.5">
            {creative.hook && (
              <Badge variant="secondary" className="max-w-full font-normal">
                <span className="truncate">Hook: {creative.hook}</span>
              </Badge>
            )}
            {creative.cta && (
              <Badge variant="outline" className="max-w-full font-normal">
                <span className="truncate">CTA: {creative.cta}</span>
              </Badge>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            variant={isWinner ? "default" : "outline"}
            size="sm"
            disabled={winnerSaving}
            onClick={toggleWinner}
            className={cn(isWinner && "bg-yellow-500 text-black hover:bg-yellow-500/90")}
          >
            <Star className={cn("h-4 w-4", isWinner && "fill-current")} />
            {isWinner ? "Winner" : "Mark winner"}
          </Button>

          <div className="flex items-center gap-1 flex-1 min-w-0">
            <span className="text-xs text-muted-foreground shrink-0">ROAS</span>
            <Input
              value={roasInput}
              onChange={(e) => {
                setRoasInput(e.target.value)
                setRoasErr(false)
              }}
              onBlur={saveRoas}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur()
              }}
              placeholder="e.g. 2.4x"
              disabled={roasSaving}
              aria-invalid={roasErr}
              className="h-8 text-sm"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default CreativeCard
