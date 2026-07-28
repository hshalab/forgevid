"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { Crown, Loader2, Sparkles, Play } from "lucide-react"
import { toast } from "sonner"
import { withCsrfHeaders } from "@/lib/csrf-client"
import { pollAiJob } from "@/lib/ai-job-poll-client"

interface RunwayModel {
  id: string
  label: string
}

interface RunwayAvailability {
  models: RunwayModel[]
  creditCost: number
  minDuration: number
  maxDuration: number
  aspectRatios: string[]
  /** Evidence-based ranking from the learning system's provider router, best first. */
  recommendations?: { model: string; reason: string; evidenceCount: number }[]
}

/**
 * Frontier AI video (Runway + the third-party models it hosts: Google Veo,
 * ByteDance Seedance, Kuaishou Kling). Generates brand-new footage from a
 * text prompt — unlike the AI Creator tab, which assembles free stock clips.
 * Pro plans only; every render bills purchased credits, so nothing starts
 * without an explicit click on a button that names the cost.
 */
export function RunwayStudioPanel() {
  const [availability, setAvailability] = useState<RunwayAvailability | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "upgrade" | "unconfigured" | "error">("loading")
  const [stateMessage, setStateMessage] = useState("")
  const [prompt, setPrompt] = useState("")
  const [model, setModel] = useState("")
  const [aspect, setAspect] = useState<"16:9" | "9:16" | "1:1">("16:9")
  const [duration, setDuration] = useState(5)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState("loading")
    try {
      const res = await fetch("/api/videos/runway/generate")
      const data = await res.json()
      if (res.status === 403) {
        setState("upgrade")
        setStateMessage(data?.error ?? "AI video generation requires the Pro plan")
        return
      }
      if (res.status === 503) {
        setState("unconfigured")
        setStateMessage(data?.error ?? "AI video generation is not configured")
        return
      }
      if (!res.ok) throw new Error(data?.error || "Could not load AI video options")
      setAvailability(data)
      // Default to the learning system's top recommendation when it names a
      // model this panel actually exposes; first curated model otherwise.
      const recommended = data.recommendations?.[0]?.model
      const models: RunwayModel[] = data.models ?? []
      setModel(models.some((m: RunwayModel) => m.id === recommended) ? recommended : models[0]?.id ?? "")
      setState("ready")
    } catch (error) {
      setState("error")
      setStateMessage(error instanceof Error ? error.message : "Could not load AI video options")
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const generate = async () => {
    if (prompt.trim().length < 3) {
      toast.error("Describe the video you want generated")
      return
    }

    setGenerating(true)
    setProgress(0)
    setVideoUrl(null)
    try {
      const res = await fetch("/api/videos/runway/generate", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ promptText: prompt, model, aspectRatio: aspect, duration }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "AI video generation failed to start")

      const result = await pollAiJob(data?.videoId, {
        onProgress: setProgress,
        errorFallback: "AI video generation failed",
        timeoutMessage: "AI video generation timed out",
      })
      setVideoUrl(result.videoUrl ?? result.reviewPreviewUrl)
      setProgress(100)
      toast.success(result.requiresReview ? "Video ready — held for your review in the AI Studio." : "AI video ready!")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI video generation failed")
    } finally {
      setGenerating(false)
    }
  }

  if (state === "loading") {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading AI video options…
        </CardContent>
      </Card>
    )
  }

  if (state !== "ready" || !availability) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Frontier AI Video
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed p-4 flex items-start gap-3">
            <Crown className="h-5 w-5 mt-0.5 text-muted-foreground" />
            <div className="text-sm">
              <p className="font-medium">
                {state === "upgrade" ? "Frontier AI video is a Pro feature" : "Frontier AI video unavailable"}
              </p>
              <p className="text-muted-foreground">{stateMessage}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const durations = Array.from(
    { length: availability.maxDuration - availability.minDuration + 1 },
    (_, i) => availability.minDuration + i,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" /> Frontier AI Video
        </CardTitle>
        <CardDescription>
          Generates brand-new AI footage from your prompt via Runway, Google
          Veo, ByteDance Seedance, or Kuaishou Kling — unlike AI Creator,
          which assembles free stock clips. Each render uses{" "}
          {availability.creditCost} purchased credits (or your monthly quota)
          — nothing starts until you click Generate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Describe the video to generate — e.g. 'A slow aerial shot over a misty pine forest at sunrise'"
        />

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border bg-background p-2 text-sm"
            aria-label="AI model"
          >
            {availability.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value as "16:9" | "9:16" | "1:1")}
            className="rounded-md border bg-background p-2 text-sm"
            aria-label="Aspect ratio"
          >
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
          </select>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="rounded-md border bg-background p-2 text-sm"
            aria-label="Duration"
          >
            {durations.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
        </div>

        <Button onClick={generate} disabled={generating} className="w-full">
          {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          {generating ? "Generating…" : `Generate AI video (${availability.creditCost} credits)`}
        </Button>

        {generating && <Progress value={progress} />}

        {videoUrl && (
          <video controls playsInline className="w-full rounded-lg border">
            <source src={videoUrl} type="video/mp4" />
          </video>
        )}
      </CardContent>
    </Card>
  )
}

export default RunwayStudioPanel
