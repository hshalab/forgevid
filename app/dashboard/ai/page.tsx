"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Sparkles, Wand2, Brain, Heart, Zap, Clock, Play, Download, Eye, TrendingUp, Star, X, MessageCircle } from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { toast } from "sonner"
import AIChatPanel from "@/components/ai-chat-panel"
import SceneEditorPanel from "@/components/scene-editor-panel"
import MediaPicker from "@/components/media-picker"
import AvatarStudioPanel from "@/components/avatar-studio-panel"
import RunwayStudioPanel from "@/components/runway-studio-panel"
import SiteBriefPanel from "@/components/site-brief-panel"
import { VoicePreviewButton } from "@/components/voice-preview-button"
import { withCsrfHeaders } from "@/lib/csrf-client"

interface AnalyticsSummary {
  total: number
  thisMonth: number
  completed: number
  inProgress: number
  failed: number
  completionRate: number
  totalMinutes: number
  avgSeconds: number
}

interface AnalyticsData {
  summary: AnalyticsSummary
  usage: { plan: string; thisMonth: number; videoLimit: number }
  monthly: { month: string; videos: number }[]
}

interface EmotionInsights {
  overallTone: string
  emotions: { name: string; intensity: number }[]
  beats: { moment: string; emotion: string; note: string }[]
  suggestions: string[]
}

interface Suggestion {
  title: string
  detail: string
}

/** Real, honest suggestions derived only from the user's own generation history. */
function buildSuggestions(a: AnalyticsData): Suggestion[] {
  const { summary, usage, monthly } = a
  const suggestions: Suggestion[] = []

  if (summary.avgSeconds > 0) {
    const mm = Math.floor(summary.avgSeconds / 60)
    const ss = (summary.avgSeconds % 60).toString().padStart(2, "0")
    suggestions.push(
      summary.avgSeconds > 90
        ? {
            title: `Your videos average ${mm}:${ss}`,
            detail:
              "That's on the longer side for social feeds — try a punchier 9:16 short (30-60s) for TikTok/Reels/Shorts.",
          }
        : {
            title: `Your videos average ${mm}:${ss}`,
            detail: "That short length works well for social feeds — keep leaning into it.",
          },
    )
  }

  if (summary.total > 0) {
    let detail = `${summary.completed} of ${summary.total} video${summary.total === 1 ? "" : "s"} finished successfully.`
    if (summary.failed > 0) {
      detail += ` ${summary.failed} failed — worth retrying with a shorter script or different footage.`
    }
    if (summary.inProgress > 0) {
      detail += ` ${summary.inProgress} still processing.`
    }
    suggestions.push({ title: `${summary.completionRate}% completion rate`, detail })
  }

  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1]
    const prev = monthly[monthly.length - 2]
    if (last.videos > prev.videos) {
      suggestions.push({
        title: "Output is climbing",
        detail: `${last.videos} videos in ${last.month} vs ${prev.videos} in ${prev.month} — keep the momentum going.`,
      })
    } else if (last.videos < prev.videos) {
      suggestions.push({
        title: "Output slowed down",
        detail: `${last.videos} videos in ${last.month} vs ${prev.videos} in ${prev.month}. A quick one today keeps the habit alive.`,
      })
    } else if (last.videos > 0) {
      suggestions.push({
        title: "Steady pace",
        detail: `${last.videos} videos in both ${last.month} and ${prev.month}.`,
      })
    }
  }

  if (usage.videoLimit > 0) {
    const remaining = Math.max(0, usage.videoLimit - usage.thisMonth)
    suggestions.push({
      title: `${usage.thisMonth} of ${usage.videoLimit} videos used this month`,
      detail:
        remaining <= 1
          ? `You're close to your ${usage.plan} plan limit — consider upgrading if you need more this month.`
          : `${remaining} left on your ${usage.plan} plan this month.`,
    })
  }

  return suggestions
}

export default function AIFeaturesPage() {
  const [prompt, setPrompt] = useState("")
  const [videoLength, setVideoLength] = useState([60])
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [selectedStyle, setSelectedStyle] = useState("modern")
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9")
  const [voices, setVoices] = useState<Array<{ id: string; name: string; gender: string; description: string }>>([])
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("")
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([])
  const [quality, setQuality] = useState<"draft" | "full" | "4k">("full")
  const [voiceMode, setVoiceMode] = useState<"ai" | "own">("ai")
  const [narrationAssetId, setNarrationAssetId] = useState<string | null>(null)
  const [narrationName, setNarrationName] = useState<string>("")
  const [uploadingNarration, setUploadingNarration] = useState(false)
  const [musicAssetId, setMusicAssetId] = useState<string | null>(null)
  const [musicName, setMusicName] = useState<string>("")
  const [uploadingMusic, setUploadingMusic] = useState(false)
  const [transitionType, setTransitionType] = useState<string>("fade")
  const [activeTab, setActiveTab] = useState<string>("chat")
  const [captionPreset, setCaptionPreset] = useState<string>("default")
  const [forgeVidEndCard, setForgeVidEndCard] = useState(false)
  // Best-of-3 storyboards: plan 3 candidates, auto-score, render the winner.
  const [bestOfStoryboards, setBestOfStoryboards] = useState(false)
  const [pipAssetId, setPipAssetId] = useState<string | null>(null)
  const [pipName, setPipName] = useState<string>("")
  const [uploadingPip, setUploadingPip] = useState(false)
  const [pipPosition, setPipPosition] = useState<string>("bottom-right")
  const [language, setLanguage] = useState<"en" | "es" | "fr" | "de" | "it" | "pt" | "zh" | "ja" | "ko" | "hi">("en")
  // Voiceover + subtitles on by default: a marketing video is expected to talk
  // and caption, and this makes the narration voice picker visible immediately
  // (it lives under the AI Voiceover add-on) instead of hidden until ticked.
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>(["voiceover", "subtitles"])
  const [generatedVideo, setGeneratedVideo] = useState<string | null>(null)
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null)
  // Set when a render finished but the automated quality gate / fact check
  // held it for the owner's review (controlled learning system).
  const [reviewHold, setReviewHold] = useState<{ previewUrl: string | null; issues: string[] } | null>(null)

  // One place that turns a jobs/quality-review payload into the human-readable
  // issue list the review card shows — quality gate, fact check, the AI visual
  // reviewer, an explicit hold reason (e.g. translation review), and any
  // back-translation lines that drifted.
  const reviewIssuesFrom = (source: any): string[] => {
    const holdDetails = source.reviewHold?.details
    return [
      ...(Array.isArray(source.qualityGate?.issues) ? source.qualityGate.issues : []),
      ...(Array.isArray(source.factCheck?.unsourcedNumbers) && source.factCheck.unsourcedNumbers.length
        ? [`Narration states number(s) not in your prompt: ${source.factCheck.unsourcedNumbers.join(', ')}`]
        : []),
      ...(Array.isArray(source.visualReview?.issues) ? source.visualReview.issues : []),
      ...(source.reviewHold?.reason ? [source.reviewHold.reason] : []),
      ...(Array.isArray(holdDetails?.lines)
        ? holdDetails.lines
            .filter((line: any) => line?.flagged)
            .map((line: any) => `Possible translation drift: "${line.original}" round-tripped as "${line.backTranslated}"`)
        : []),
    ].map(String)
  }
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false)
  const [generatedScript, setGeneratedScript] = useState<string | null>(null)

  // Real analytics/suggestions data — shared by the Analytics and Smart Suggestions tabs.
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)

  // Emotion AI: a real script -> LLM emotion breakdown.
  const [emotionScript, setEmotionScript] = useState("")
  const [emotionLoading, setEmotionLoading] = useState(false)
  const [emotionError, setEmotionError] = useState<string | null>(null)
  const [emotionResult, setEmotionResult] = useState<EmotionInsights | null>(null)

  // Load the narration voice catalog (static — works without an ElevenLabs key).
  useEffect(() => {
    fetch('/api/voices')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.voices) return
        setVoices(data.voices)
        setSelectedVoiceId((current) => current || data.defaultVoiceId || '')
      })
      .catch(() => {
        /* voice selection is optional; the server falls back to the default */
      })
  }, [])

  // A render held for review must survive navigation: without this, leaving
  // the page orphaned the video in REVIEW_REQUIRED with no way back to the
  // accept/reject card. Hydrate the newest held video on load.
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/videos')
        if (!res.ok) return
        const data = await res.json()
        const held = (data.videos ?? []).find((v: { status: string }) => v.status === 'REVIEW_REQUIRED')
        if (!held) return
        const reviewRes = await fetch(`/api/videos/${held.id}/quality-review`)
        if (!reviewRes.ok) return
        const review = await reviewRes.json()
        setCurrentVideoId(held.id)
        setReviewHold({ previewUrl: review.previewUrl ?? null, issues: reviewIssuesFrom(review) })
      } catch {
        /* best-effort — a failed hydration just means no review card */
      }
    })()
  }, [])

  // The platform's memory of this user: open pre-set to what they actually use.
  // Explicit template params (?prompt=&style=&aspect=) win over learned defaults.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const qpPrompt = params.get('prompt')
    const qpStyle = params.get('style')
    const qpAspect = params.get('aspect')
    if (qpPrompt) setPrompt(qpPrompt)
    if (qpStyle) setSelectedStyle(qpStyle)
    if (qpAspect === '16:9' || qpAspect === '9:16' || qpAspect === '1:1') {
      setSelectedAspectRatio(qpAspect)
    }

    fetch('/api/me/defaults')
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!d || d.basedOnVideos === 0) return
        if (!qpStyle && d.style) setSelectedStyle(d.style)
        if (!qpAspect && (d.aspectRatio === '16:9' || d.aspectRatio === '9:16' || d.aspectRatio === '1:1')) {
          setSelectedAspectRatio(d.aspectRatio)
        }
        if (d.voiceId) setSelectedVoiceId((current) => current || d.voiceId)
      })
      .catch(() => {
        /* defaults are a convenience, never a blocker */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load the user's real analytics once — the Analytics tab renders it directly,
  // the Smart Suggestions tab derives honest suggestions from it.
  useEffect(() => {
    fetch('/api/user/analytics')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load analytics'))))
      .then((data: AnalyticsData) => setAnalytics(data))
      .catch(() => setAnalyticsError('Could not load your analytics right now.'))
      .finally(() => setAnalyticsLoading(false))
  }, [])

  const suggestions = useMemo(() => (analytics ? buildSuggestions(analytics) : []), [analytics])

  const handleAnalyzeEmotion = async () => {
    const script = emotionScript.trim()
    if (script.length < 10) {
      toast.error('Paste at least 10 characters of script to analyze')
      return
    }

    setEmotionLoading(true)
    setEmotionError(null)
    setEmotionResult(null)

    try {
      const response = await fetch('/api/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to analyze script')
      }
      setEmotionResult(data.insights)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to analyze script'
      setEmotionError(message)
      toast.error(message)
    } finally {
      setEmotionLoading(false)
    }
  }

  // Handle escape key to close video modal
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isVideoFullscreen) {
        setIsVideoFullscreen(false)
      }
    }

    if (isVideoFullscreen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isVideoFullscreen])

  // `overrides` exists for callers that just changed state (the chat brief):
  // React state set a moment ago is NOT visible to this closure yet, so the
  // brief passes its values explicitly instead of hoping setState landed.
  const handleGenerate = async (overrides?: {
    prompt?: string
    style?: string
    duration?: number
    addOns?: string[]
    mediaAssetIds?: string[]
    language?: "en" | "es" | "fr" | "de" | "it" | "pt" | "zh" | "ja" | "ko" | "hi"
  }) => {
    const effPrompt = overrides?.prompt ?? prompt
    const effStyle = overrides?.style ?? selectedStyle
    const effDuration = overrides?.duration ?? videoLength[0]
    const effAddOns = overrides?.addOns ?? selectedAddOns
    const effMediaIds = overrides?.mediaAssetIds ?? selectedMediaIds
    const effLanguage = overrides?.language ?? language
    if (!effPrompt.trim()) {
      toast.error('Please enter a video description')
      return
    }

    setIsGenerating(true)
    setGenerationProgress(0)
    setGeneratedVideo(null)
    setReviewHold(null)

    try {
      // Kick off the job — returns immediately with a videoId to poll.
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_video',
          prompt: effPrompt,
          style: effStyle,
          duration: effDuration,
          addOns: effAddOns,
          aspectRatio: selectedAspectRatio,
          ...(effLanguage !== "en" ? { language: effLanguage } : {}),
          ...(voiceMode === "ai" && selectedVoiceId ? { voiceId: selectedVoiceId } : {}),
          ...(voiceMode === "own" && narrationAssetId ? { narrationAssetId } : {}),
          ...(effAddOns.includes("music") && musicAssetId ? { musicAssetId } : {}),
          ...(effMediaIds.length ? { mediaAssetIds: effMediaIds } : {}),
          ...(effAddOns.includes("subtitles") && captionPreset !== "default"
            ? { captionPreset }
            : {}),
          ...(pipAssetId ? { pip: { assetId: pipAssetId, position: pipPosition } } : {}),
          renderQuality: quality,
          forgeVidEndCard,
          ...(bestOfStoryboards ? { planCandidates: 3 } : {}),
          transition:
            transitionType === "none" ? null : { type: transitionType, duration: 0.5 },
        }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      const videoId = data?.data?.videoId
      if (!data.success || !videoId) {
        throw new Error(data.error || 'Failed to start generation')
      }
      setCurrentVideoId(videoId)

      // Poll real server-side progress until a terminal state (15 min cap).
      const deadline = Date.now() + 15 * 60 * 1000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000))

        const statusRes = await fetch(`/api/ai/jobs/${videoId}`)
        if (!statusRes.ok) continue
        const job = await statusRes.json()

        setGenerationProgress(job.percent ?? 0)

        if (job.status === 'COMPLETED' && job.videoUrl) {
          const url = job.videoUrl.includes('?')
            ? `${job.videoUrl}&t=${Date.now()}`
            : `${job.videoUrl}?t=${Date.now()}`
          setGeneratedVideo(url)
          setGenerationProgress(100)
          setIsGenerating(false)
          toast.success('🎉 Video generated! Check the preview below.')
          return
        }
        // Held for the owner's review by the automated quality gate / fact
        // check — terminal for polling; the review card takes it from here.
        if (job.status === 'REVIEW_REQUIRED' || job.requiresReview) {
          setReviewHold({ previewUrl: job.reviewPreviewUrl ?? null, issues: reviewIssuesFrom(job) })
          setGenerationProgress(100)
          setIsGenerating(false)
          toast.info('Render finished but was held for your review — see the checks below.')
          return
        }
        if (job.status === 'FAILED') {
          throw new Error(job.error || 'Generation failed')
        }
      }

      throw new Error('Generation timed out')
    } catch (error) {
      console.error('Error generating video:', error)
      setIsGenerating(false)
      setGenerationProgress(0)
      toast.error(`❌ ${error instanceof Error ? error.message : 'Failed to generate video'}`)
    }
  }

  const handleAddOnChange = (addOn: string, checked: boolean) => {
    if (checked) {
      setSelectedAddOns([...selectedAddOns, addOn])
    } else {
      setSelectedAddOns(selectedAddOns.filter((item) => item !== addOn))
    }
  }

  return (
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="font-heading text-3xl font-bold flex items-center gap-3">
              <Sparkles className="h-8 w-8 text-primary" />
              AI Studio
            </h1>
            <p className="text-muted-foreground mt-2">
              Transform your ideas into professional videos with advanced AI technology
            </p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-7">
              <TabsTrigger value="chat" className="flex items-center gap-1">
                <MessageCircle className="h-3 w-3" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="create">AI Creator</TabsTrigger>
              <TabsTrigger value="avatar">AI Presenter</TabsTrigger>
              <TabsTrigger value="frontier">Frontier AI</TabsTrigger>
              <TabsTrigger value="emotion" className="flex items-center gap-1">
                <Heart className="h-3 w-3" />
                Emotion AI
              </TabsTrigger>
              <TabsTrigger value="recommendations" className="flex items-center gap-1">
                <Brain className="h-3 w-3" />
                Smart Suggestions
              </TabsTrigger>
              <TabsTrigger value="analytics" className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                AI Analytics
              </TabsTrigger>
            </TabsList>

            {/* AI Chat Tab */}
            <TabsContent value="chat">
              <AIChatPanel
                onGenerateVideo={(brief) => {
                  // Mirror the brief into the form so the Creator tab shows it...
                  setPrompt(brief.description)
                  setSelectedStyle(brief.style)
                  setVideoLength([brief.duration])
                  setSelectedAddOns(brief.addOns)
                  // ...but generate from the brief DIRECTLY: state set one line
                  // up is not visible to handleGenerate's closure yet, which is
                  // exactly how this button used to silently do nothing.
                  setActiveTab('create')
                  toast.success('Generating from your brief — watch the progress here.')
                  void handleGenerate({
                    prompt: brief.description,
                    style: brief.style,
                    duration: brief.duration,
                    addOns: brief.addOns,
                  })
                }}
                onGenerateFromSite={({ prompt: sitePrompt, mediaAssetIds, duration }) => {
                  // The chat already turned "make a video for <site>" into a
                  // grounded script + the site's own images. Load them and
                  // generate directly from the Creator tab.
                  setPrompt(sitePrompt)
                  if (mediaAssetIds.length > 0) setSelectedMediaIds(mediaAssetIds)
                  if (duration) setVideoLength([duration])
                  setActiveTab('create')
                  toast.success('Generating from the website — watch the progress here.')
                  void handleGenerate({ prompt: sitePrompt, duration, mediaAssetIds })
                }}
              />
            </TabsContent>

            {/* AI Creator Tab */}
            <TabsContent value="create" className="space-y-6">
              {/* Paste a URL -> a grounded commercial script + the site's own images */}
              <SiteBriefPanel
                duration={videoLength[0]}
                onBrief={(brief) => {
                  setPrompt(brief.prompt)
                  if (brief.mediaAssetIds.length > 0) setSelectedMediaIds(brief.mediaAssetIds)
                }}
              />

              <div className="grid lg:grid-cols-2 gap-6">
                {/* Input Panel */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Wand2 className="h-5 w-5 text-primary" />
                      AI Video Generator
                    </CardTitle>
                    <CardDescription>Describe your video idea and let AI create it for you</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Prompt Input */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Video Description</label>
                      <Textarea
                        placeholder="Create a product advertisement for eco-friendly running shoes. Show athletes in nature, emphasize sustainability, upbeat music, modern transitions..."
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        className="min-h-[120px]"
                      />
                    </div>

                    {/* Video Length */}
                    <div className="space-y-3">
                      <label className="text-sm font-medium">
                        Video Length: {Math.floor(videoLength[0] / 60)}:
                        {(videoLength[0] % 60).toString().padStart(2, "0")}
                      </label>
                      <Slider
                        value={videoLength}
                        onValueChange={setVideoLength}
                        min={15}
                        max={300}
                        step={15}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>15s</span>
                        <span>5min</span>
                      </div>
                    </div>

                    {/* Style Selection */}
                    <div className="space-y-3">
                      <label className="text-sm font-medium">Video Style</label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: "modern", name: "Modern", desc: "Clean, minimal" },
                          { id: "cinematic", name: "Cinematic", desc: "Film-like quality" },
                          { id: "energetic", name: "Energetic", desc: "Fast-paced, dynamic" },
                          { id: "professional", name: "Professional", desc: "Corporate, polished" },
                        ].map((style) => (
                          <Button
                            key={style.id}
                            variant="outline"
                            className={`h-auto p-3 flex flex-col items-start transition-all ${
                              selectedStyle === style.id 
                                ? 'border-cyan-400 bg-cyan-400/10 text-white' 
                                : 'border-gray-600 bg-gray-800/50 text-gray-300 hover:border-gray-500 hover:bg-gray-700/50'
                            }`}
                            onClick={() => setSelectedStyle(style.id)}
                          >
                            <div className="font-medium">{style.name}</div>
                            <div className="text-xs text-muted-foreground">{style.desc}</div>
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Aspect Ratio */}
                    <div className="space-y-3">
                      <label className="text-sm font-medium">Aspect Ratio</label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: "16:9" as const, name: "16:9", desc: "YouTube" },
                          { id: "9:16" as const, name: "9:16", desc: "TikTok / Reels" },
                          { id: "1:1" as const, name: "1:1", desc: "Feed post" },
                        ].map((ratio) => (
                          <Button
                            key={ratio.id}
                            variant="outline"
                            className={`h-auto p-3 flex flex-col items-start transition-all ${
                              selectedAspectRatio === ratio.id
                                ? 'border-cyan-400 bg-cyan-400/10 text-white'
                                : 'border-gray-600 bg-gray-800/50 text-gray-300 hover:border-gray-500 hover:bg-gray-700/50'
                            }`}
                            onClick={() => setSelectedAspectRatio(ratio.id)}
                          >
                            <div className="font-medium">{ratio.name}</div>
                            <div className="text-xs text-muted-foreground">{ratio.desc}</div>
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Narration language — the spoken words + captions. The
                        multilingual voices speak all of these natively. */}
                    <div className="space-y-3">
                      <label className="text-sm font-medium">Narration language</label>
                      <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value as typeof language)}
                        className="w-full rounded-md border border-gray-600 bg-gray-800/50 p-2 text-sm text-gray-200"
                      >
                        <option value="en">🇺🇸 English</option>
                        <option value="es">🇪🇸 Español (Spanish)</option>
                        <option value="fr">🇫🇷 Français (French)</option>
                        <option value="de">🇩🇪 Deutsch (German)</option>
                        <option value="it">🇮🇹 Italiano (Italian)</option>
                        <option value="pt">🇧🇷 Português (Portuguese)</option>
                        <option value="zh">🇨🇳 中文 (Chinese)</option>
                        <option value="ja">🇯🇵 日本語 (Japanese)</option>
                        <option value="ko">🇰🇷 한국어 (Korean)</option>
                        <option value="hi">🇮🇳 हिन्दी (Hindi)</option>
                      </select>
                    </div>

                    {/* Your own footage/photos — they fill scenes in order */}
                    <MediaPicker
                      value={selectedMediaIds}
                      onChange={setSelectedMediaIds}
                      disabled={isGenerating}
                    />

                    {/* Add-ons */}
                    <div className="space-y-3">
                      <label className="text-sm font-medium">Add-ons</label>
                      <div className="space-y-2">
                        {[
                          { id: "subtitles", name: "Auto Subtitles", desc: "AI-generated captions" },
                          { id: "music", name: "Background Music", desc: "Mood-matched soundtrack" },
                          { id: "voiceover", name: "AI Voiceover", desc: "Natural speech synthesis" },
                          { id: "effects", name: "Smart Effects", desc: "Emotion-aware transitions" },
                        ].map((addon) => (
                          <div key={addon.id} className="flex items-center space-x-3">
                            <Checkbox
                              id={addon.id}
                              checked={selectedAddOns.includes(addon.id)}
                              onCheckedChange={(checked) => handleAddOnChange(addon.id, checked as boolean)}
                            />
                            <div className="flex-1">
                              <label htmlFor={addon.id} className="text-sm font-medium cursor-pointer">
                                {addon.name}
                              </label>
                              <p className="text-xs text-muted-foreground">{addon.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Caption look — karaoke = word-by-word highlight (Reels/TikTok) */}
                    {selectedAddOns.includes("subtitles") && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Caption style</label>
                        <select
                          value={captionPreset}
                          onChange={(e) => setCaptionPreset(e.target.value)}
                          className="w-full rounded-md border border-gray-600 bg-gray-800/50 p-2 text-sm text-gray-200"
                        >
                          <option value="default">Standard — clean bottom captions</option>
                          <option value="large">Large — bigger, bolder text</option>
                          <option value="subtle">Subtle — smaller, discreet</option>
                          <option value="karaoke">Karaoke — word-by-word highlight (Reels/TikTok)</option>
                        </select>
                      </div>
                    )}

                    <div className="flex items-center space-x-3 rounded-md border border-gray-700 p-3">
                      <Checkbox id="forgevid-end-card" checked={forgeVidEndCard} onCheckedChange={(checked) => setForgeVidEndCard(Boolean(checked))} />
                      <div>
                        <label htmlFor="forgevid-end-card" className="text-sm font-medium cursor-pointer">Add “Created with ForgeVid” end card</label>
                        <p className="text-xs text-muted-foreground">Optional two-second bookend. Free-plan watermark rules remain unchanged.</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 rounded-md border border-gray-700 p-3">
                      <Checkbox id="best-of-storyboards" checked={bestOfStoryboards} onCheckedChange={(checked) => setBestOfStoryboards(Boolean(checked))} />
                      <div>
                        <label htmlFor="best-of-storyboards" className="text-sm font-medium cursor-pointer">Best-of-3 storyboards</label>
                        <p className="text-xs text-muted-foreground">Plans three candidate storyboards, auto-scores them, and renders only the winner. Slightly slower to start; same render cost.</p>
                      </div>
                    </div>

                    {/* Bring-your-own music — the bundled library ships empty
                        (tracks need a licence), so this is how a soundtrack
                        actually gets onto a video. */}
                    {selectedAddOns.includes("music") && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Music track</label>
                        <input
                          type="file"
                          accept="audio/*"
                          disabled={uploadingMusic}
                          onChange={async (e) => {
                            const file = e.target.files?.[0]
                            e.target.value = ""
                            if (!file) return
                            setUploadingMusic(true)
                            try {
                              const body = new FormData()
                              body.append("file", file)
                              const res = await fetch("/api/music", { method: "POST", body })
                              const data = await res.json()
                              if (!res.ok) throw new Error(data?.error || "Upload failed")
                              setMusicAssetId(data.assetId)
                              setMusicName(data.name || file.name)
                              toast.success("Music uploaded — it will play under the video")
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Upload failed")
                            } finally {
                              setUploadingMusic(false)
                            }
                          }}
                          className="w-full text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          {musicAssetId
                            ? `Using: ${musicName}. It loops and ducks under any narration.`
                            : "Upload a track you have the rights to (mp3/wav/m4a, max 30MB). No track is bundled."}
                        </p>
                      </div>
                    )}

                    {/* Render quality + scene transition */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label htmlFor="quality" className="text-sm font-medium">Quality</label>
                        <select
                          id="quality"
                          value={quality}
                          onChange={(e) => setQuality(e.target.value as "draft" | "full" | "4k")}
                          className="w-full rounded-md border border-gray-600 bg-gray-800/50 p-2 text-sm text-gray-200"
                        >
                          <option value="draft">Draft — fast preview (half res)</option>
                          <option value="full">Full — 1080p export</option>
                          <option value="4k">4K — Pro plan</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="transition" className="text-sm font-medium">Transition</label>
                        <select
                          id="transition"
                          value={transitionType}
                          onChange={(e) => setTransitionType(e.target.value)}
                          className="w-full rounded-md border border-gray-600 bg-gray-800/50 p-2 text-sm text-gray-200"
                        >
                          <option value="none">Hard cuts</option>
                          <option value="fade">Cross-fade</option>
                          <option value="fadeblack">Fade through black</option>
                          <option value="fadewhite">Fade through white</option>
                          <option value="wipeleft">Wipe left</option>
                          <option value="wiperight">Wipe right</option>
                          <option value="slideleft">Slide left</option>
                          <option value="slideright">Slide right</option>
                          <option value="circleopen">Circle open</option>
                          <option value="dissolve">Dissolve</option>
                        </select>
                      </div>
                    </div>

                    {/* Narration: an AI voice, or the user's own recording (natural voice) */}
                    {selectedAddOns.includes("voiceover") && (
                      <div className="space-y-3">
                        <label className="text-sm font-medium">Narration</label>
                        <div className="flex gap-4 text-sm">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="voiceMode"
                              checked={voiceMode === "ai"}
                              onChange={() => setVoiceMode("ai")}
                            />
                            AI voice
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="voiceMode"
                              checked={voiceMode === "own"}
                              onChange={() => setVoiceMode("own")}
                            />
                            My own recording
                          </label>
                        </div>

                        {voiceMode === "ai" && voices.length > 0 && (
                          <div className="flex items-center gap-2">
                            <select
                              id="voice"
                              value={selectedVoiceId}
                              onChange={(e) => setSelectedVoiceId(e.target.value)}
                              className="w-full rounded-md border border-gray-600 bg-gray-800/50 p-2 text-sm text-gray-200"
                            >
                              {voices.map((voice) => (
                                <option key={voice.id} value={voice.id}>
                                  {voice.name} — {voice.gender}, {voice.description}
                                </option>
                              ))}
                            </select>
                            <VoicePreviewButton voiceId={selectedVoiceId} />
                          </div>
                        )}

                        {voiceMode === "own" && (
                          <div className="space-y-2">
                            <input
                              type="file"
                              accept="audio/*,video/webm"
                              disabled={uploadingNarration}
                              onChange={async (e) => {
                                const file = e.target.files?.[0]
                                e.target.value = ""
                                if (!file) return
                                setUploadingNarration(true)
                                try {
                                  const body = new FormData()
                                  body.append("file", file)
                                  const res = await fetch("/api/narration", {
                                    method: "POST",
                                    headers: withCsrfHeaders(),
                                    body,
                                  })
                                  const data = await res.json()
                                  if (!res.ok) throw new Error(data?.error || "Upload failed")
                                  setNarrationAssetId(data.assetId)
                                  setNarrationName(data.fileName || file.name)
                                  toast.success("Narration uploaded — it will replace the AI voice")
                                } catch (err) {
                                  toast.error(err instanceof Error ? err.message : "Upload failed")
                                } finally {
                                  setUploadingNarration(false)
                                }
                              }}
                              className="w-full text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                              {narrationAssetId
                                ? `Using: ${narrationName}. Captions are transcribed from your recording; scene timing follows your requested length.`
                                : "Upload your recorded narration (mp3/wav/m4a/webm, max 50MB)."}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Presenter overlay (picture-in-picture) */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Presenter overlay (optional)</label>
                      <input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        disabled={uploadingPip}
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ""
                          if (!file) return
                          setUploadingPip(true)
                          try {
                            const body = new FormData()
                            body.append("file", file)
                            const res = await fetch("/api/media/upload", { method: "POST", body })
                            const data = await res.json()
                            if (!res.ok) throw new Error(data?.error || "Upload failed")
                            setPipAssetId(data.mediaAssetIds?.[0] ?? null)
                            setPipName(file.name)
                            toast.success("Presenter clip ready")
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Upload failed")
                          } finally {
                            setUploadingPip(false)
                          }
                        }}
                        className="w-full text-sm"
                      />
                      {pipAssetId ? (
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="truncate">Using: {pipName}</span>
                          <select
                            value={pipPosition}
                            onChange={(e) => setPipPosition(e.target.value)}
                            className="rounded-md border border-gray-600 bg-gray-800/50 p-1 text-xs text-gray-200"
                          >
                            <option value="bottom-right">Bottom right</option>
                            <option value="bottom-left">Bottom left</option>
                            <option value="top-right">Top right</option>
                            <option value="top-left">Top left</option>
                          </select>
                          <button
                            type="button"
                            className="underline hover:text-foreground"
                            onClick={() => { setPipAssetId(null); setPipName("") }}
                          >
                            remove
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          A clip of you (or the salesperson) overlaid in a corner for the whole
                          video. Its sound is muted — record the voice as "My own recording" above.
                        </p>
                      )}
                    </div>

                    {/* Generate Button */}
                    <Button
                      className="w-full"
                      size="lg"
                      onClick={() => handleGenerate()}
                      disabled={!prompt.trim() || isGenerating}
                    >
                      {isGenerating ? (
                        <>
                          <Wand2 className="h-4 w-4 mr-2 animate-spin" />
                          Generating Video...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 mr-2" />
                          Generate Video
                        </>
                      )}
                    </Button>

                    {/* Generation Progress */}
                    {isGenerating && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>AI is creating your video...</span>
                          <span>{generationProgress}%</span>
                        </div>
                        <Progress value={generationProgress} className="w-full" />
                        <p className="text-xs text-muted-foreground">
                          This may take 2-3 minutes depending on video length and complexity
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Review hold — automated checks flagged the render; the owner decides. */}
                {reviewHold && (
                  <Card className="border-amber-500/50">
                    <CardHeader>
                      <CardTitle>Held for your review</CardTitle>
                      <CardDescription>
                        The render finished, but automated checks flagged it. Watch the
                        preview and decide — nothing is published until you accept.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {reviewHold.previewUrl && (
                        <video controls playsInline className="w-full rounded-lg border">
                          <source src={reviewHold.previewUrl} type="video/mp4" />
                        </video>
                      )}
                      {reviewHold.issues.length > 0 && (
                        <ul className="list-disc pl-5 text-sm text-muted-foreground">
                          {reviewHold.issues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      )}
                      <div className="flex gap-2">
                        <Button
                          className="flex-1"
                          onClick={async () => {
                            if (!currentVideoId) return
                            const res = await fetch(`/api/videos/${currentVideoId}/quality-review`, {
                              method: 'PATCH',
                              headers: withCsrfHeaders({ 'Content-Type': 'application/json' }),
                              body: JSON.stringify({ action: 'accept' }),
                            })
                            if (res.ok) {
                              setGeneratedVideo(reviewHold.previewUrl)
                              setReviewHold(null)
                              toast.success('Accepted — the video is now published to your library.')
                            } else {
                              toast.error('Could not accept the video — try again.')
                            }
                          }}
                        >
                          Accept & publish
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={async () => {
                            if (!currentVideoId) return
                            const res = await fetch(`/api/videos/${currentVideoId}/quality-review`, {
                              method: 'PATCH',
                              headers: withCsrfHeaders({ 'Content-Type': 'application/json' }),
                              body: JSON.stringify({ action: 'reject' }),
                            })
                            if (res.ok) {
                              setReviewHold(null)
                              toast.info('Noted — the render stays unpublished. Adjust the prompt and regenerate.')
                            } else {
                              toast.error('Could not record the rejection — try again.')
                            }
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Preview Panel */}
                <Card>
                  <CardHeader>
                    <CardTitle>AI Generation Preview</CardTitle>
                    <CardDescription>Your generated video will appear here</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="aspect-video bg-muted rounded-lg flex items-center justify-center mb-4 overflow-hidden relative">
                      {generatedVideo ? (
                        <div className="relative w-full h-full">
                          <video 
                            key={generatedVideo} 
                            controls 
                            autoPlay
                            className="w-full h-full object-cover rounded-lg"
                            preload="auto"
                            onClick={() => setIsVideoFullscreen(true)}
                          >
                            <source src={generatedVideo} type="video/mp4" />
                            Your browser does not support the video tag.
                          </video>
                          <Button
                            variant="outline"
                            size="sm"
                            className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white border-white/20"
                            onClick={() => setIsVideoFullscreen(true)}
                          >
                            <Play className="h-3 w-3 mr-1" />
                            Fullscreen
                          </Button>
                        </div>
                      ) : (
                        <div className="text-center text-muted-foreground">
                          <Sparkles className="h-12 w-12 mx-auto mb-2" />
                          <p>Generated video preview</p>
                          <p className="text-sm">Start creating to see your AI-generated content</p>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        className="flex-1 bg-transparent"
                        disabled={!generatedVideo}
                        onClick={() => setIsVideoFullscreen(true)}
                      >
                        <Play className="h-4 w-4 mr-2" />
                        Preview
                      </Button>
                      <Button 
                        variant="outline" 
                        className="flex-1 bg-transparent"
                        disabled={!generatedVideo}
                        onClick={() => {
                          if (generatedVideo) {
                            const link = document.createElement('a');
                            link.href = generatedVideo;
                            link.download = `ai-generated-video-${Date.now()}.mp4`;
                            link.click();
                          }
                        }}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </Button>
                      {generatedScript && (
                        <Button
                          variant="outline"
                          className="flex-1 bg-transparent"
                          onClick={() => {
                            console.log('========================================')
                            console.log('🎬 YOUR CUSTOM GENERATED SCRIPT:')
                            console.log('========================================')
                            console.log(generatedScript)
                            console.log('========================================')
                            toast.success('✅ Script logged to console! Press F12 to view your custom script.')
                          }}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Script
                        </Button>
                      )}
                      {generatedVideo && (
                        <Button
                          variant="outline"
                          className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white"
                          onClick={() => {
                            // Force reload the video
                            const newUrl = generatedVideo.split('?')[0] + `?t=${Date.now()}`;
                            setGeneratedVideo(newUrl);
                            toast.success('🔄 Video reloaded! If still showing old video, clear browser cache (Ctrl+Shift+R)');
                          }}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Reload Video
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Scene-by-scene editing: tweak a line, swap footage, re-render */}
              {currentVideoId && generatedVideo && (
                <SceneEditorPanel
                  videoId={currentVideoId}
                  onRerendered={(url) => setGeneratedVideo(url)}
                />
              )}
            </TabsContent>

            {/* AI presenter (HeyGen) — Pro plans; renders bill provider credits */}
            <TabsContent value="avatar" className="space-y-6">
              <AvatarStudioPanel />
            </TabsContent>

            {/* Frontier AI video (Runway/Veo/Seedance/Kling) — Pro plans; opt-in, bills credits */}
            <TabsContent value="frontier" className="space-y-6">
              <RunwayStudioPanel />
            </TabsContent>

            {/* Emotion AI Tab */}
            <TabsContent value="emotion" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Heart className="h-5 w-5 text-primary" />
                    Emotion-Aware AI
                  </CardTitle>
                  <CardDescription>
                    Paste a script or narration and the AI reads back its real emotional tone and beats.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder="Paste your video script or narration here..."
                    value={emotionScript}
                    onChange={(e) => setEmotionScript(e.target.value)}
                    className="min-h-[160px]"
                    maxLength={8000}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">{emotionScript.length}/8000 characters</p>
                    <Button
                      onClick={handleAnalyzeEmotion}
                      disabled={emotionLoading || emotionScript.trim().length < 10}
                    >
                      {emotionLoading ? (
                        <>
                          <Wand2 className="h-4 w-4 mr-2 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Heart className="h-4 w-4 mr-2" />
                          Analyze Script
                        </>
                      )}
                    </Button>
                  </div>

                  {emotionError && <p className="text-sm text-red-400">{emotionError}</p>}

                  {!emotionResult && !emotionLoading && !emotionError && (
                    <p className="text-sm text-muted-foreground">
                      Paste at least a couple of sentences above and click Analyze Script to get a real
                      emotional read from the AI — no canned percentages.
                    </p>
                  )}

                  {emotionResult && (
                    <div className="space-y-6 pt-2">
                      <p className="text-sm text-muted-foreground">{emotionResult.overallTone}</p>

                      <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <h4 className="font-medium">Emotional Breakdown</h4>
                          <div className="space-y-3">
                            {emotionResult.emotions.map((item) => (
                              <div key={item.name} className="space-y-1">
                                <div className="flex justify-between text-sm">
                                  <span>{item.name}</span>
                                  <span>{item.intensity}%</span>
                                </div>
                                <div className="w-full bg-muted rounded-full h-2">
                                  <div
                                    className="bg-primary h-2 rounded-full transition-all"
                                    style={{ width: `${item.intensity}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h4 className="font-medium">Story Beats</h4>
                          <div className="space-y-2">
                            {emotionResult.beats.map((beat, index) => (
                              <div key={index} className="p-3 border rounded-lg">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-medium">{beat.moment}</span>
                                  <Badge variant="secondary">{beat.emotion}</Badge>
                                </div>
                                {beat.note && (
                                  <p className="text-xs text-muted-foreground mt-1">{beat.note}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {emotionResult.suggestions.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="font-medium">Suggestions</h4>
                          <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
                            {emotionResult.suggestions.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Smart Suggestions Tab */}
            <TabsContent value="recommendations" className="space-y-6">
              {analyticsLoading ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    Loading your suggestions...
                  </CardContent>
                </Card>
              ) : analyticsError ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    {analyticsError}
                  </CardContent>
                </Card>
              ) : !analytics || analytics.summary.total === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    <Brain className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p>Make your first video and personalized suggestions will show up here.</p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="h-5 w-5 text-primary" />
                      Suggestions From Your Own Videos
                    </CardTitle>
                    <CardDescription>
                      Derived from your actual generation history — nothing fabricated or trending
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {suggestions.map((s, index) => (
                      <div key={index} className="p-3 border rounded-lg">
                        <div className="font-medium text-sm">{s.title}</div>
                        <div className="text-xs text-muted-foreground mt-1">{s.detail}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* AI Analytics Tab */}
            <TabsContent value="analytics" className="space-y-6">
              {analyticsLoading ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    Loading your analytics...
                  </CardContent>
                </Card>
              ) : analyticsError ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    {analyticsError}
                  </CardContent>
                </Card>
              ) : !analytics || analytics.summary.total === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p>No analytics yet — generate your first video to see real stats here.</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid md:grid-cols-3 gap-6">
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Videos</CardTitle>
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{analytics.summary.total}</div>
                        <p className="text-xs text-muted-foreground">
                          {analytics.summary.thisMonth} made this month
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Completion Rate</CardTitle>
                        <Star className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{analytics.summary.completionRate}%</div>
                        <p className="text-xs text-muted-foreground">
                          {analytics.summary.completed} completed
                          {analytics.summary.failed > 0 ? `, ${analytics.summary.failed} failed` : ""}
                          {analytics.summary.inProgress > 0
                            ? `, ${analytics.summary.inProgress} in progress`
                            : ""}
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Average Length</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {Math.floor(analytics.summary.avgSeconds / 60)}:
                          {(analytics.summary.avgSeconds % 60).toString().padStart(2, "0")}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {analytics.summary.totalMinutes} min created in total
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle>6-Month Activity</CardTitle>
                      <CardDescription>Videos created per month, from your account</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {(() => {
                          const max = Math.max(1, ...analytics.monthly.map((m) => m.videos))
                          return analytics.monthly.map((m) => (
                            <div key={m.month} className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span>{m.month}</span>
                                <span>{m.videos}</span>
                              </div>
                              <div className="w-full bg-muted rounded-full h-2">
                                <div
                                  className="bg-primary h-2 rounded-full transition-all"
                                  style={{ width: `${(m.videos / max) * 100}%` }}
                                />
                              </div>
                            </div>
                          ))
                        })()}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Plan Usage</CardTitle>
                      <CardDescription>
                        Videos used this month on the {analytics.usage.plan} plan
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>{analytics.usage.thisMonth} used</span>
                        <span>{analytics.usage.videoLimit} limit</span>
                      </div>
                      <Progress
                        value={
                          analytics.usage.videoLimit > 0
                            ? Math.min(100, (analytics.usage.thisMonth / analytics.usage.videoLimit) * 100)
                            : 0
                        }
                        className="w-full"
                      />
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>
          </Tabs>

          {/* Fullscreen Video Modal */}
          {isVideoFullscreen && generatedVideo && (
            <div 
              className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8"
              onClick={() => setIsVideoFullscreen(false)}
            >
              <Button
                variant="outline"
                size="sm"
                className="absolute top-4 right-4 z-20 bg-black/70 hover:bg-black/90 text-white border-white/30 rounded-full w-10 h-10 p-0"
                onClick={() => setIsVideoFullscreen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
              <video 
                controls 
                autoPlay
                className="w-full h-auto max-w-6xl rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <source src={generatedVideo} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>
          )}
        </div>
  )
}
