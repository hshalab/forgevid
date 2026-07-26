"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Play, Download, Share2, Trash2, Plus, Search, Clock, Eye, Calendar, Loader2 } from "lucide-react"
import { useState, useEffect, useRef, useCallback } from "react"
import { VideoPlayerModal } from "@/components/video-player-modal"

interface VideoRow {
  id: string
  title: string
  description?: string | null
  status: string
  thumbnail?: string | null
  duration?: number | null
  fileSize?: number | null
  url?: string | null
  fileUrl?: string | null
  createdAt: string
  updatedAt?: string
}
interface DeadLetterRow {
  id: string
  videoId: string
  kind: string
  error: string
  attempts: number
  status: string
  createdAt: string
}

function formatDuration(sec?: number | null): string {
  if (sec == null) return ""
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return "—"
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  } catch {
    return ""
  }
}

function playableUrl(v: VideoRow): string | null {
  return v.fileUrl || v.url || null
}

export default function VideosPage() {
  const [videos, setVideos] = useState<VideoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTab, setSelectedTab] = useState("all")
  const [selectedVideo, setSelectedVideo] = useState<VideoRow | null>(null)
  const [isPlayerOpen, setIsPlayerOpen] = useState(false)
  const [deadLetters, setDeadLetters] = useState<DeadLetterRow[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadVideos = useCallback(async () => {
    try {
      const res = await fetch("/api/videos")
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.videos)) setVideos(data.videos)
    } catch {
      /* leave list empty on failure */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadVideos()
    fetch("/api/videos/dead-letter").then((response) => response.ok ? response.json() : null)
      .then((data) => setDeadLetters(data?.jobs?.filter((job: DeadLetterRow) => job.status === "PENDING") || []))
      .catch(() => {})
  }, [loadVideos])

  const handleDeadLetter = async (id: string, action: "replay" | "resolve") => {
    const response = await fetch("/api/videos/dead-letter", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return alert(data.error || "Could not update the failed job.")
    setDeadLetters((current) => current.filter((item) => item.id !== id))
  }

  const filteredVideos = videos.filter((v) => {
    const matchesSearch = (v.title || "").toLowerCase().includes(searchQuery.toLowerCase())
    const matchesTab = selectedTab === "all" || (v.status || "").toLowerCase() === selectedTab
    return matchesSearch && matchesTab
  })

  const totalStorage = videos.reduce((sum, v) => sum + (v.fileSize || 0), 0)
  const completedCount = videos.filter((v) => (v.status || "").toLowerCase() === "completed").length
  const processingCount = videos.filter((v) => (v.status || "").toLowerCase() === "processing").length

  const openPlayer = (video: VideoRow) => {
    if (!playableUrl(video)) return
    setSelectedVideo(video)
    setIsPlayerOpen(true)
  }

  const downloadVideo = (v: VideoRow) => {
    const u = playableUrl(v)
    if (!u) return
    const a = document.createElement("a")
    a.href = u
    a.download = `${v.title || "video"}.mp4`
    a.target = "_blank"
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const shareVideo = async (v: VideoRow) => {
    const u = playableUrl(v)
    if (!u) return
    try {
      await navigator.clipboard.writeText(u)
      alert("Video link copied to clipboard!")
    } catch {
      alert(u)
    }
  }

  const deleteVideo = async (v: VideoRow) => {
    if (!confirm(`Delete "${v.title}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/videos/${v.id}`, { method: "DELETE" })
      if (res.ok) {
        setVideos((prev) => prev.filter((x) => x.id !== v.id))
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Could not delete the video.")
      }
    } catch {
      alert("Network error while deleting.")
    }
  }

  const onUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("title", file.name.replace(/\.[^.]+$/, ""))
      const res = await fetch("/api/videos/upload", { method: "POST", body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error || "Upload failed.")
        return
      }
      await loadVideos()
    } catch {
      alert("Network error during upload.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="min-h-[600px]">
      <input ref={fileInputRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={onUploadFile} />

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading text-3xl font-bold">My Videos</h1>
          <p className="text-muted-foreground mt-1">Every video you generate lands here</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search videos..." className="pl-10 w-64" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            {uploading ? "Uploading…" : "Upload Video"}
          </Button>
        </div>
      </div>

      {deadLetters.length > 0 && (
        <Card className="mb-8 border-amber-500/40">
          <CardContent className="space-y-3 p-6">
            <div><h2 className="font-semibold">Failed render review</h2><p className="text-sm text-muted-foreground">Final failures are retained for review. Replay is always a manual action.</p></div>
            {deadLetters.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
                <span>{job.kind} · {job.attempts} attempts · {job.error}</span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void handleDeadLetter(job.id, "replay")}>Replay</Button>
                  <Button size="sm" variant="outline" onClick={() => void handleDeadLetter(job.id, "resolve")}>Dismiss</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Stats Cards — real */}
      <div className="grid md:grid-cols-4 gap-6 mb-8">
        <Card className="min-h-[110px]">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Videos</p>
                <p className="text-2xl font-bold">{videos.length}</p>
              </div>
              <Play className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold">{completedCount}</p>
              </div>
              <Eye className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Storage Used</p>
                <p className="text-2xl font-bold">{formatBytes(totalStorage)}</p>
              </div>
              <Download className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Processing</p>
                <p className="text-2xl font-bold">{processingCount}</p>
              </div>
              <Clock className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Video Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">All Videos</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="processing">Processing</TabsTrigger>
          <TabsTrigger value="draft">Drafts</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedTab}>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading your videos…
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredVideos.map((video) => {
                const url = playableUrl(video)
                return (
                  <Card key={video.id} className="group hover:shadow-lg transition-shadow">
                    <div className="relative cursor-pointer" onClick={() => openPlayer(video)}>
                      {video.thumbnail ? (
                        <img src={video.thumbnail} alt={video.title} className="w-full h-48 object-cover rounded-t-lg" />
                      ) : (
                        <div className="w-full h-48 rounded-t-lg bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                          <Play className="h-10 w-10 text-white/70" />
                        </div>
                      )}
                      {url && (
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-t-lg flex items-center justify-center">
                          <Button variant="secondary"><Play className="h-4 w-4 mr-1" /> Play</Button>
                        </div>
                      )}
                      <Badge className="absolute top-2 right-2" variant={(video.status || "").toLowerCase() === "completed" ? "default" : "secondary"}>
                        {(video.status || "").toLowerCase()}
                      </Badge>
                      {video.duration != null && (
                        <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">{formatDuration(video.duration)}</div>
                      )}
                    </div>

                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold line-clamp-2 mb-2">{video.title}</h3>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1"><Calendar className="h-4 w-4" />{formatDate(video.createdAt)}</div>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{formatBytes(video.fileSize)}</div>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <Button variant="ghost" size="sm" disabled={!url} onClick={() => shareVideo(video)}><Share2 className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="sm" disabled={!url} onClick={() => downloadVideo(video)}><Download className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => deleteVideo(video)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Empty State */}
          {!loading && filteredVideos.length === 0 && (
            <div className="text-center py-12">
              <Play className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No videos yet</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery ? "Try adjusting your search." : "Generate your first video in AI Studio and it will show up here."}
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Video Player Modal */}
      {selectedVideo && (
        <VideoPlayerModal video={selectedVideo} isOpen={isPlayerOpen} onClose={() => { setIsPlayerOpen(false); setSelectedVideo(null) }} />
      )}
    </div>
  )
}
