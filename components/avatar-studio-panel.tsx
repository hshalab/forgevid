"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { Crown, Loader2, UserSquare2, Play } from "lucide-react"
import { toast } from "sonner"
import { withCsrfHeaders } from "@/lib/csrf-client"
import { pollAiJob } from "@/lib/ai-job-poll-client"

interface Avatar {
  avatarId: string
  name: string
  previewImageUrl: string | null
}

/**
 * AI presenter videos (HeyGen). Pro plans only; renders bill provider credits,
 * so nothing starts without an explicit click.
 */
export function AvatarStudioPanel() {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [state, setState] = useState<"loading" | "ready" | "upgrade" | "unconfigured" | "error">("loading")
  const [stateMessage, setStateMessage] = useState("")
  const [selected, setSelected] = useState<string>("")
  const [script, setScript] = useState("")
  const [aspect, setAspect] = useState<"16:9" | "9:16" | "1:1">("16:9")
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState("loading")
    try {
      const res = await fetch("/api/avatars")
      const data = await res.json()
      if (res.status === 403) {
        setState("upgrade")
        setStateMessage(data?.error ?? "Avatar videos require the Pro plan")
        return
      }
      if (res.status === 503) {
        setState("unconfigured")
        setStateMessage(data?.error ?? "Avatar provider is not configured")
        return
      }
      if (!res.ok) throw new Error(data?.error || "Could not load avatars")
      setAvatars(data.avatars ?? [])
      setState("ready")
    } catch (error) {
      setState("error")
      setStateMessage(error instanceof Error ? error.message : "Could not load avatars")
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const generate = async () => {
    if (!selected) {
      toast.error("Pick an avatar first")
      return
    }
    if (script.trim().length < 5) {
      toast.error("Write a short script for the presenter")
      return
    }

    setGenerating(true)
    setProgress(0)
    setVideoUrl(null)
    try {
      const res = await fetch("/api/avatars/generate", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ script, avatarId: selected, aspectRatio: aspect }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Avatar render failed to start")

      const result = await pollAiJob(data?.data?.videoId, {
        onProgress: setProgress,
        errorFallback: "Avatar render failed",
        timeoutMessage: "Avatar render timed out",
      })
      setVideoUrl(result.videoUrl)
      setProgress(100)
      toast.success("Avatar video ready!")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Avatar render failed")
    } finally {
      setGenerating(false)
    }
  }

  if (state === "loading") {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading avatars…
        </CardContent>
      </Card>
    )
  }

  if (state !== "ready") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserSquare2 className="h-5 w-5" /> AI Presenter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed p-4 flex items-start gap-3">
            <Crown className="h-5 w-5 mt-0.5 text-muted-foreground" />
            <div className="text-sm">
              <p className="font-medium">
                {state === "upgrade" ? "Avatar videos are a Pro feature" : "Avatars unavailable"}
              </p>
              <p className="text-muted-foreground">{stateMessage}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserSquare2 className="h-5 w-5" /> AI Presenter
        </CardTitle>
        <CardDescription>
          Pick a presenter, write their script, and generate. Renders run on the
          provider and bill credits — nothing starts until you click Generate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Avatar grid (first 24; searchable catalogs can come later) */}
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-64 overflow-y-auto">
          {avatars.slice(0, 24).map((a) => (
            <button
              key={a.avatarId}
              type="button"
              onClick={() => setSelected(a.avatarId)}
              className={`rounded-lg border p-1 text-left transition ${
                selected === a.avatarId ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-muted-foreground"
              }`}
              title={a.name}
            >
              {a.previewImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.previewImageUrl} alt={a.name} className="h-16 w-full rounded object-cover" />
              ) : (
                <div className="h-16 w-full rounded bg-muted flex items-center justify-center">
                  <UserSquare2 className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <p className="text-[10px] truncate mt-1">{a.name}</p>
            </button>
          ))}
        </div>

        <Textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={4}
          placeholder="What should the presenter say?"
        />

        <div className="flex items-center gap-3">
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value as "16:9" | "9:16" | "1:1")}
            className="rounded-md border bg-background p-2 text-sm"
          >
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
          </select>
          <Button onClick={generate} disabled={generating} className="flex-1">
            {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            {generating ? "Rendering…" : "Generate presenter video"}
          </Button>
        </div>

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

export default AvatarStudioPanel
