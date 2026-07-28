"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { Shuffle, RefreshCw, Save, Film, Download, Sparkles, Loader2, Share2, ImageIcon } from "lucide-react"
import { toast } from "sonner"
import MediaPicker from "@/components/media-picker"

interface Scene {
  id: string
  index: number
  description: string
  keywords: string[]
  duration: number
  clipUrl: string
  matchedQuery: string
  thumbnailUrl?: string
}

interface SceneEditorPanelProps {
  videoId: string
  /** Called with the fresh video URL after a successful re-render. */
  onRerendered?: (videoUrl: string) => void
}

/**
 * Scene-by-scene editor: tweak a scene's line or duration, swap its stock clip,
 * then re-render. Edits mutate the stored scene list; re-render re-encodes.
 */
export function SceneEditorPanel({ videoId, onRerendered }: SceneEditorPanelProps) {
  const [scenes, setScenes] = useState<Scene[]>([])
  const [loading, setLoading] = useState(true)
  const [busyScene, setBusyScene] = useState<string | null>(null)
  const [rerendering, setRerendering] = useState(false)
  const [progress, setProgress] = useState(0)
  const [chatInput, setChatInput] = useState("")
  const [chatting, setChatting] = useState(false)
  const [sharing, setSharing] = useState(false)
  // When set, the media picker is open for this scene id.
  const [pickingFor, setPickingFor] = useState<string | null>(null)
  const [pickerValue, setPickerValue] = useState<string[]>([])

  const loadScenes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/videos/${videoId}/scenes`)
      if (!res.ok) throw new Error("Failed to load scenes")
      const data = await res.json()
      setScenes(data.scenes ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load scenes")
    } finally {
      setLoading(false)
    }
  }, [videoId])

  useEffect(() => {
    loadScenes()
  }, [loadScenes])

  const updateLocal = (sceneId: string, patch: Partial<Scene>) => {
    setScenes((prev) => prev.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)))
  }

  const saveScene = async (scene: Scene) => {
    setBusyScene(scene.id)
    try {
      const res = await fetch(`/api/videos/${videoId}/scenes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneId: scene.id,
          description: scene.description,
          duration: scene.duration,
        }),
      })
      if (!res.ok) throw new Error((await res.json())?.error || "Save failed")
      toast.success(`Scene ${scene.index + 1} saved`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed")
    } finally {
      setBusyScene(null)
    }
  }

  const swapClip = async (scene: Scene) => {
    setBusyScene(scene.id)
    try {
      const res = await fetch(`/api/videos/${videoId}/scenes/${scene.id}/swap`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Swap failed")
      updateLocal(scene.id, data.scene)
      toast.success(`Scene ${scene.index + 1}: new clip (“${data.scene.matchedQuery}”)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Swap failed")
    } finally {
      setBusyScene(null)
    }
  }

  // Point one scene at a SPECIFIC asset the user owns (not a random re-roll).
  const chooseMedia = async (scene: Scene, assetId: string) => {
    setBusyScene(scene.id)
    try {
      const res = await fetch(`/api/videos/${videoId}/scenes/${scene.id}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Could not use that media")
      updateLocal(scene.id, data.scene)
      setPickingFor(null)
      setPickerValue([])
      toast.success(`Scene ${scene.index + 1}: using your media — re-render to see it`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not use that media")
    } finally {
      setBusyScene(null)
    }
  }

  const sendChat = async () => {
    const message = chatInput.trim()
    if (!message) return
    setChatting(true)
    try {
      const res = await fetch(`/api/videos/${videoId}/scenes/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Could not apply that edit")

      setScenes(data.scenes ?? [])
      setChatInput("")
      toast.success(data.reply || "Done.")

      // Be honest about anything the assistant asked for but we refused.
      for (const s of data.skipped ?? []) {
        toast.warning(s.reason)
      }
      if (data.rerenderRequired) {
        toast.info("Hit Re-render to see the changes in the video.")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chat edit failed")
    } finally {
      setChatting(false)
    }
  }

  const shareVideo = async () => {
    setSharing(true)
    try {
      const res = await fetch(`/api/videos/${videoId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Could not enable sharing")
      const url = `${window.location.origin}${data.shareUrl}`
      await navigator.clipboard.writeText(url).catch(() => {})
      toast.success(`Share link copied: ${url}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not enable sharing")
    } finally {
      setSharing(false)
    }
  }

  const rerender = async () => {
    setRerendering(true)
    setProgress(0)
    try {
      const res = await fetch(`/api/videos/${videoId}/rerender`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Re-render failed to start")

      const deadline = Date.now() + 15 * 60 * 1000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000))
        const statusRes = await fetch(`/api/ai/jobs/${videoId}`)
        if (!statusRes.ok) continue
        const job = await statusRes.json()
        setProgress(job.percent ?? 0)

        if (job.status === "COMPLETED" && job.videoUrl) {
          setProgress(100)
          toast.success("Re-rendered with your edits")
          onRerendered?.(`${job.videoUrl.split("?")[0]}?t=${Date.now()}`)
          return
        }
        if (job.status === "REVIEW_REQUIRED" || job.requiresReview) {
          setProgress(100)
          toast.info("Re-render finished but was held for your review — accept or reject it in the AI Studio.")
          return
        }
        if (job.status === "FAILED") throw new Error(job.error || "Re-render failed")
      }
      throw new Error("Re-render timed out")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Re-render failed")
    } finally {
      setRerendering(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scenes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading scenes…</CardContent>
      </Card>
    )
  }

  if (scenes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scenes</CardTitle>
          <CardDescription>
            No scene data for this video. Scenes are saved for videos generated after this feature shipped.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const totalDuration = scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Film className="h-5 w-5" />
              Scenes ({scenes.length})
            </CardTitle>
            <CardDescription>
              Edit a line, retime it, or swap the footage — then re-render. Total {totalDuration}s.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {/* Captions are burned in; these serve the same cues as sidecar files. */}
            <Button variant="outline" size="sm" onClick={shareVideo} disabled={sharing}>
              <Share2 className="h-4 w-4 mr-2" />
              {sharing ? "Sharing…" : "Share"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/videos/${videoId}/captions?format=srt`} download>
                <Download className="h-4 w-4 mr-2" />
                SRT
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/videos/${videoId}/captions?format=vtt`} download>
                <Download className="h-4 w-4 mr-2" />
                VTT
              </a>
            </Button>
            <Button onClick={rerender} disabled={rerendering}>
              <RefreshCw className={`h-4 w-4 mr-2 ${rerendering ? "animate-spin" : ""}`} />
              {rerendering ? "Re-rendering…" : "Re-render"}
            </Button>
          </div>
        </div>
        {rerendering && <Progress value={progress} className="mt-3" />}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Chat editing: the assistant proposes structured edits, we validate them. */}
        <div className="flex items-center gap-2">
          <Input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                sendChat()
              }
            }}
            placeholder="Tell the assistant what to change — e.g. “make scene 2 faster”"
            disabled={chatting || rerendering}
          />
          <Button onClick={sendChat} disabled={chatting || rerendering || !chatInput.trim()}>
            {chatting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Ask
          </Button>
        </div>

        {scenes.map((scene) => (
          <div key={scene.id} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* Poster frame extracted at assembly time — see what you're editing */}
                {scene.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={scene.thumbnailUrl}
                    alt={`Scene ${scene.index + 1}`}
                    className="h-12 w-20 shrink-0 rounded object-cover border"
                  />
                )}
                <Badge variant="secondary">Scene {scene.index + 1}</Badge>
              </div>
              {scene.matchedQuery && (
                <span className="text-xs text-muted-foreground truncate max-w-[45%]">
                  footage: “{scene.matchedQuery}”
                </span>
              )}
            </div>

            <Textarea
              value={scene.description}
              rows={2}
              onChange={(e) => updateLocal(scene.id, { description: e.target.value })}
              placeholder="What happens in this scene"
            />

            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={120}
                value={scene.duration}
                onChange={(e) => updateLocal(scene.id, { duration: Number(e.target.value) })}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground mr-auto">seconds</span>

              <Button
                variant="outline"
                size="sm"
                onClick={() => swapClip(scene)}
                disabled={busyScene === scene.id || rerendering}
              >
                <Shuffle className="h-4 w-4 mr-2" />
                Swap clip
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPickerValue([])
                  setPickingFor(pickingFor === scene.id ? null : scene.id)
                }}
                disabled={busyScene === scene.id || rerendering}
              >
                <ImageIcon className="h-4 w-4 mr-2" />
                Choose image
              </Button>
              <Button
                size="sm"
                onClick={() => saveScene(scene)}
                disabled={busyScene === scene.id || rerendering}
              >
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
            </div>

            {pickingFor === scene.id && (
              <div className="mt-3 rounded-lg border p-3">
                <p className="text-sm font-medium mb-2">
                  Pick one of your images or clips for scene {scene.index + 1}
                </p>
                <MediaPicker
                  value={pickerValue}
                  onChange={(ids) => {
                    // Single-select: act on the most recently chosen id.
                    const chosen = ids[ids.length - 1]
                    setPickerValue(chosen ? [chosen] : [])
                    if (chosen) chooseMedia(scene, chosen)
                  }}
                  disabled={busyScene === scene.id}
                />
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export default SceneEditorPanel
