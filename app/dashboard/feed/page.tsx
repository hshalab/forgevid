"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { VOICES, DEFAULT_VOICE_ID } from "@/lib/voice-catalog"
import { VoicePreviewButton } from "@/components/voice-preview-button"
import { Car, Home, ShoppingBag, Loader2, ArrowRight, CheckCircle2, AlertCircle, Rss, Eye, Clock, Upload, FileImage } from "lucide-react"
import { cn } from "@/lib/utils"

type VerticalKey = "automotive" | "realestate" | "ecommerce"
type ImportMode = "feed" | "single" | "screenshots"

const SAMPLES: Record<VerticalKey, unknown[]> = {
  automotive: [
    { ref: "STK-1001", title: "2022 Toyota RAV4 XLE", year: 2022, make: "Toyota", model: "RAV4", trim: "XLE", price: "$28,900", mileage: "24,000 mi", highlights: "One owner, clean history, all-wheel drive, backup camera.", photos: ["https://picsum.photos/id/1071/1200/800", "https://picsum.photos/id/1080/1200/800"] },
    { ref: "STK-1002", title: "2021 Honda Civic LX", year: 2021, make: "Honda", model: "Civic", trim: "LX", price: "$21,500", mileage: "31,000 mi", highlights: "Great on gas, Apple CarPlay, backup camera.", photos: ["https://picsum.photos/id/1063/1200/800", "https://picsum.photos/id/183/1200/800"] },
  ],
  realestate: [
    { ref: "MLS-501", address: "14 Maple Court, Miami, FL", price: "$685,000", beds: 4, baths: 2, highlights: "Renovated kitchen, large garden, quiet street.", photos: ["https://picsum.photos/id/1084/1200/800", "https://picsum.photos/id/101/1200/800"] },
    { ref: "MLS-502", address: "9 Oak Lane, Miami, FL", price: "$412,500", beds: 3, baths: 1, highlights: "Close to schools, updated bathrooms.", photos: ["https://picsum.photos/id/106/1200/800", "https://picsum.photos/id/110/1200/800"] },
  ],
  ecommerce: [
    { ref: "SKU-9001", title: "Wireless Earbuds Pro", price: "$49.00", brand: "Acme Audio", description: "Crisp, immersive sound with active noise cancellation.", photos: ["https://picsum.photos/id/1069/1000/1000", "https://picsum.photos/id/1078/1000/1000"] },
    { ref: "SKU-9002", title: "Everyday Backpack", price: "$79.00", brand: "Trailhead", description: "Water-resistant, 20L, padded laptop sleeve.", photos: ["https://picsum.photos/id/21/1000/1000", "https://picsum.photos/id/26/1000/1000"] },
  ],
}

const VERTICALS: Record<VerticalKey, { label: string; icon: typeof Car; endpoint: string; arrayField: string; defaultAspect: string; languages: boolean; hint: string }> = {
  automotive: { label: "Automotive", icon: Car, endpoint: "/api/vehicles/batch", arrayField: "vehicles", defaultAspect: "16:9", languages: true, hint: "Each vehicle needs a title (or make + model + year) and at least one photo URL. Price, mileage, stock #/VIN are optional." },
  realestate: { label: "Real estate", icon: Home, endpoint: "/api/listings/batch", arrayField: "listings", defaultAspect: "16:9", languages: false, hint: "Each listing needs an address and at least one photo URL. Price, beds, baths are optional." },
  ecommerce: { label: "E-commerce", icon: ShoppingBag, endpoint: "/api/products/batch", arrayField: "products", defaultAspect: "9:16", languages: false, hint: "Each product needs a title and at least one photo URL. Price, brand, description are optional." },
}

const ASPECTS = ["16:9", "9:16", "1:1"]
const REAL_ESTATE_HOSTS = ["homes.com", "zillow.com", "realtor.com", "redfin.com", "trulia.com"]

function realEstatePageHost(raw: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return REAL_ESTATE_HOSTS.find((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ?? null
  } catch {
    return null
  }
}

function wordsFromSlug(raw: string): string {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const useful = url.pathname.split("/").filter(Boolean)
      .find((part) => /\d/.test(part) && /[-_]/.test(part))
    if (!useful) return ""
    return decodeURIComponent(useful)
      .replace(/[-_]+/g, " ")
      .replace(/\bM\d{5,}\b.*$/i, "")
      .replace(/\b(unit|apt)\s+(\d+)/i, "Unit $2")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  } catch {
    return ""
  }
}

function isProbablyItemPage(raw: string): boolean {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return !/\.(json|xml|csv)(?:$|\?)/i.test(url.pathname) &&
      !/(feed|api|inventory-feed|reso)/i.test(url.pathname)
  } catch {
    return false
  }
}

interface PreviewItem { ref: string; label: string; photos: number }
interface BatchResult { ref: string; label: string; language?: string; videoId?: string; photosUsed?: number; error?: string }
interface BatchResponse { started: number; failed: number; message?: string; results: BatchResult[] }
interface JobStatus { status: string; percent: number; thumbnail?: string | null; videoUrl?: string | null; error?: string | null }
interface SavedSource {
  id: string; name: string; vertical: string; feedUrl: string; scheduleEnabled: boolean;
  cadence: string; lastSuccessAt?: string | null; lastError?: string | null;
  runs?: Array<{ id: string; status: string; itemsRead: number; itemsFailed: number; startedAt: string; errorArchive?: string | null }>
}

export default function FeedToVideosPage() {
  const [vertical, setVertical] = useState<VerticalKey>("automotive")
  const [mode, setMode] = useState<ImportMode>("feed")
  const [feedKind, setFeedKind] = useState<"url" | "paste">("url")
  const [feedUrl, setFeedUrl] = useState("")
  const [pasteText, setPasteText] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const [itemTitle, setItemTitle] = useState("")
  const [price, setPrice] = useState("")
  const [beds, setBeds] = useState("")
  const [baths, setBaths] = useState("")
  const [mileage, setMileage] = useState("")
  const [highlights, setHighlights] = useState("")
  const [contact, setContact] = useState("")
  const [photoUrls, setPhotoUrls] = useState("")
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [inlineNotice, setInlineNotice] = useState<string | null>(null)
  const [aspect, setAspect] = useState("16:9")
  const [duration, setDuration] = useState(16)
  const [langEn, setLangEn] = useState(true)
  const [langEs, setLangEs] = useState(false)
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID)
  const [captionPreset, setCaptionPreset] = useState<string>("default")
  const [approvedByUser, setApprovedByUser] = useState(false)
  const [sources, setSources] = useState<SavedSource[]>([])
  const [sourceForm, setSourceForm] = useState({
    name: "", authorizationBasis: "", authorizationExpiresAt: "", apiKey: "",
    fieldMapping: "", scheduleEnabled: false, cadence: "daily",
  })
  const [sourceSaving, setSourceSaving] = useState(false)

  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<{ count: number; items: PreviewItem[] } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<BatchResponse | null>(null)
  const [jobs, setJobs] = useState<Record<string, JobStatus>>({})
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cfg = VERTICALS[vertical]

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current) }, [])
  const loadSources = () => fetch("/api/inventory/sources", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then((data) => setSources(data.sources || []))
    .catch(() => {})
  useEffect(() => { void loadSources() }, [])

  async function saveSource() {
    if (!feedUrl.trim()) { setError("Enter the authorized feed URL first."); return }
    setSourceSaving(true); setError(null)
    try {
      let fieldMapping: Record<string, string> | undefined
      if (sourceForm.fieldMapping.trim()) {
        fieldMapping = JSON.parse(sourceForm.fieldMapping)
        if (!fieldMapping || Array.isArray(fieldMapping) || typeof fieldMapping !== "object") throw new Error("Field mapping must be a JSON object.")
      }
      const response = await fetch("/api/inventory/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sourceForm.name || new URL(feedUrl).hostname,
          vertical: vertical === "automotive" ? "auto" : vertical === "realestate" ? "realestate" : "ecom",
          feedUrl,
          authorizationBasis: sourceForm.authorizationBasis,
          authorizationExpiresAt: sourceForm.authorizationExpiresAt ? new Date(sourceForm.authorizationExpiresAt).toISOString() : null,
          fieldMapping,
          credentials: sourceForm.apiKey ? { apiKey: sourceForm.apiKey } : undefined,
          scheduleEnabled: sourceForm.scheduleEnabled,
          cadence: sourceForm.cadence,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Could not save the source.")
      setSourceForm({ name: "", authorizationBasis: "", authorizationExpiresAt: "", apiKey: "", fieldMapping: "", scheduleEnabled: false, cadence: "daily" })
      await loadSources()
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the source.") } finally { setSourceSaving(false) }
  }

  async function runSavedSource(id: string) {
    setSourceSaving(true); setError(null)
    const response = await fetch(`/api/inventory/sources/${id}/run`, { method: "POST" })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) setError(data.error || "Import failed.")
    await loadSources(); setSourceSaving(false)
  }

  function resetOutputs() { setPreview(null); setResult(null); setJobs({}); setError(null); if (pollRef.current) clearTimeout(pollRef.current) }
  function selectVertical(v: VerticalKey) { setVertical(v); setAspect(VERTICALS[v].defaultAspect); setPasteText(""); resetOutputs() }
  function loadSample() { setMode("feed"); setFeedKind("paste"); setPasteText(JSON.stringify(SAMPLES[vertical], null, 2)); setPreview(null) }

  function singleItem() {
    const remotePhotos = photoUrls.split(/\r?\n|,/).map((url) => url.trim()).filter(Boolean)
    if (sourceUrl.trim() && remotePhotos.some((url) => url === sourceUrl.trim())) {
      throw new Error("The original listing/detail page is not a photo URL. Remove it from Authorized photo URLs and upload the actual photos.")
    }
    const photos = [...uploadedUrls, ...remotePhotos]
    if (!itemTitle.trim()) throw new Error(vertical === "realestate" ? "Enter the property address." : "Enter a title.")
    if (photos.length === 0) throw new Error("Upload at least one authorized photo or add an authorized photo URL.")
    const note = [highlights.trim(), contact.trim() && `Contact: ${contact.trim()}`, sourceUrl.trim() && `Source reference: ${sourceUrl.trim()}`].filter(Boolean).join("\n")
    if (vertical === "realestate") return { ref: "manual-listing", address: itemTitle.trim(), price: price.trim() || undefined, beds: beds ? Number(beds) : undefined, baths: baths ? Number(baths) : undefined, highlights: note || undefined, photos }
    if (vertical === "automotive") return { ref: "manual-vehicle", title: itemTitle.trim(), price: price.trim() || undefined, mileage: mileage.trim() || undefined, highlights: note || undefined, photos }
    return { ref: "manual-product", title: itemTitle.trim(), price: price.trim() || undefined, description: note || undefined, photos }
  }

  function collectBody(extra: Record<string, unknown>): Record<string, unknown> {
    const body: Record<string, unknown> = { duration, aspectRatio: aspect, voiceId, approvedByUser, ...extra }
    if (captionPreset !== "default") body.captionPreset = captionPreset
    if (mode === "single" || mode === "screenshots") {
      body[cfg.arrayField] = [singleItem()]
    } else if (feedKind === "url") {
      if (!feedUrl.trim()) throw new Error("Enter an MLS/CRM feed URL, or switch to Paste data.")
      body.feedUrl = feedUrl.trim()
    } else {
      let arr: unknown
      try { arr = JSON.parse(pasteText) } catch { throw new Error("Pasted data is not valid JSON.") }
      if (!Array.isArray(arr) || arr.length === 0) throw new Error("Paste a non-empty JSON array of items.")
      body[cfg.arrayField] = arr
    }
    if (cfg.languages) {
      const langs = [langEn ? "en" : null, langEs ? "es" : null].filter(Boolean)
      if (langs.length === 0) throw new Error("Pick at least one language.")
      body.languages = langs
    }
    return body
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch(cfg.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status}).`)
    return data
  }

  async function runPreview() {
    resetOutputs(); setApprovedByUser(false); setPreviewing(true)
    try {
      if ((mode === "single" || mode === "screenshots") && photoUrls.trim()) {
        const urls = photoUrls.split(/\r?\n|,/).map((url) => url.trim()).filter(Boolean)
        const response = await fetch("/api/media/validate-urls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls, sourceUrl: sourceUrl.trim() || undefined }),
        })
        const validation = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(validation.error || "Could not validate the photo URLs.")
        if (!validation.valid) {
          const first = validation.invalid?.[0]
          throw new Error(`${first?.reason || "One or more photo URLs are not usable"} Use Upload authorized photos for the most reliable result.`)
        }
      }
      const data = await post(collectBody({ preview: true }))
      setPreview({ count: data.count ?? 0, items: data.items ?? [] })
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong.") } finally { setPreviewing(false) }
  }

  async function uploadFiles(files: FileList | File[], extract = false) {
    const selected = Array.from(files)
    if (selected.length === 0) return
    setError(null)
    if (extract) {
      setExtracting(true)
      try {
        const extractBody = new FormData()
        extractBody.set("vertical", vertical)
        selected.slice(0, 3).forEach((file) => extractBody.append("files", file))
        const response = await fetch("/api/listings/extract-screenshot", { method: "POST", body: extractBody })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || "Could not read those screenshots.")
        setItemTitle(data.address || data.title || itemTitle)
        setPrice(data.price || "")
        setBeds(data.beds == null ? "" : String(data.beds))
        setBaths(data.baths == null ? "" : String(data.baths))
        setMileage(data.mileage || "")
        setHighlights(data.highlights || data.description || "")
        setInlineNotice("AI extracted the visible details. Review every field before previewing; ForgeVid may be wrong.")
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read those screenshots.")
      } finally {
        setExtracting(false)
      }
    }
    setUploading(true)
    try {
      const body = new FormData()
      selected.forEach((file) => body.append("files", file))
      const response = await fetch("/api/media/upload", { method: "POST", body })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Photo upload failed.")
      setUploadedUrls((current) => [...current, ...(data.assets || []).map((asset: { url: string }) => asset.url)])
      setMode(extract ? "screenshots" : "single")
      setPreview(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed.")
    } finally {
      setUploading(false)
    }
  }

  function handleFeedUrl(value: string) {
    setFeedUrl(value)
    const propertyHost = realEstatePageHost(value)
    if (propertyHost) {
      setVertical("realestate")
      setAspect(VERTICALS.realestate.defaultAspect)
    }
    if (isProbablyItemPage(value)) {
      const nextVertical = propertyHost ? "realestate" : vertical
      setMode("single")
      setSourceUrl(value)
      setItemTitle(wordsFromSlug(value))
      setInlineNotice(`${propertyHost || "This site"} does not provide an authorized inventory feed at that URL. We prefilled what can be read safely from the URL—add details and photos you are authorized to use.`)
    }
    setPreview(null)
  }

  async function runGenerate() {
    setError(null); setGenerating(true)
    try {
      if (mode === "single" || mode === "screenshots") {
        const photos = [...uploadedUrls, ...photoUrls.split(/\r?\n|,/).map((url) => url.trim()).filter(Boolean)]
        const records = await Promise.all(photos.map((assetUrl) => fetch("/api/inventory/authorizations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetUrl: new URL(assetUrl, window.location.origin).toString(),
            sourceUrl: sourceUrl.trim() || null,
            authorizationBasis: uploadedUrls.includes(assetUrl) ? "customer-upload" : "customer-authorized-url",
            authorizedBy: "account owner confirmation",
          }),
        })))
        if (records.some((response) => !response.ok)) throw new Error("Could not persist photo authorization. Generation was not started.")
      }
      const data = (await post(collectBody({}))) as BatchResponse
      setResult(data)
      const ids = (data.results ?? []).filter((r) => r.videoId).map((r) => r.videoId as string)
      startPolling(ids)
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong.") } finally { setGenerating(false) }
  }

  function startPolling(ids: string[]) {
    if (pollRef.current) clearTimeout(pollRef.current)
    const terminal = (s?: string) => s === "COMPLETED" || s === "FAILED" || s === "CANCELLED"
    const tick = async () => {
      const entries = await Promise.all(ids.map(async (id) => {
        try { const r = await fetch(`/api/ai/jobs/${id}`); return [id, await r.json()] as const } catch { return [id, null] as const }
      }))
      const update: Record<string, JobStatus> = {}
      for (const [id, j] of entries) if (j) update[id] = j
      setJobs((prev) => ({ ...prev, ...update }))
      if (!ids.every((id) => terminal(update[id]?.status))) pollRef.current = setTimeout(tick, 4000)
    }
    tick()
  }

  const langBoth = cfg.languages && langEn && langEs
  const previewLabel = preview ? `Generate ${preview.count * (langBoth ? 2 : 1)} video${preview.count * (langBoth ? 2 : 1) === 1 ? "" : "s"}` : "Generate"

  const toggle = (active: boolean) =>
    cn("px-3 py-2 rounded-lg text-sm font-medium border transition",
      active ? "bg-orange-500 text-white border-orange-500" : "bg-white/5 text-gray-300 border-white/10 hover:bg-white/10")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Rss className="h-6 w-6 text-orange-400" /> Feed → Videos
        </h1>
        <p className="text-gray-400 mt-1">Point us at your inventory feed (or paste it) and we make a video for every item — one shared flow for every vertical.</p>
      </div>

      <Card className="border-blue-500/25 bg-blue-950/10">
        <CardHeader>
          <CardTitle>Saved MLS/CRM sources</CardTitle>
          <CardDescription>Store an authorized source, optional encrypted API key, field mapping, and import schedule. Credentials are never shown again.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Input value={sourceForm.name} onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })} placeholder="Source name" />
            <Input value={sourceForm.authorizationBasis} onChange={(e) => setSourceForm({ ...sourceForm, authorizationBasis: e.target.value })} placeholder="Authorization basis (for example: brokerage RESO agreement)" />
            <Input type="date" value={sourceForm.authorizationExpiresAt} onChange={(e) => setSourceForm({ ...sourceForm, authorizationExpiresAt: e.target.value })} aria-label="Authorization expiration" />
            <Input type="password" autoComplete="new-password" value={sourceForm.apiKey} onChange={(e) => setSourceForm({ ...sourceForm, apiKey: e.target.value })} placeholder="Optional feed API key" />
          </div>
          <Textarea value={sourceForm.fieldMapping} onChange={(e) => setSourceForm({ ...sourceForm, fieldMapping: e.target.value })} placeholder={'Optional JSON field mapping, e.g. {"title":"vehicle_name","ref":"stock_id","photos":"image_urls"}'} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sourceForm.scheduleEnabled} onChange={(e) => setSourceForm({ ...sourceForm, scheduleEnabled: e.target.checked })} /> Scheduled import</label>
            <select className="h-9 rounded-md border bg-background px-3" value={sourceForm.cadence} onChange={(e) => setSourceForm({ ...sourceForm, cadence: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
            <Button onClick={() => void saveSource()} disabled={sourceSaving || !feedUrl || !sourceForm.authorizationBasis}>{sourceSaving && <Loader2 className="h-4 w-4 animate-spin" />} Save current feed</Button>
          </div>
          {sources.map((source) => (
            <div key={source.id} className="rounded-lg border border-white/10 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><strong>{source.name}</strong> <Badge variant="outline">{source.vertical}</Badge><div className="max-w-xl truncate text-xs text-muted-foreground">{source.feedUrl}</div></div>
                <Button size="sm" variant="outline" onClick={() => void runSavedSource(source.id)} disabled={sourceSaving}>Import now</Button>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{source.scheduleEnabled ? `${source.cadence} schedule` : "Manual"} · Last success: {source.lastSuccessAt ? new Date(source.lastSuccessAt).toLocaleString() : "never"}</div>
              {source.lastError && <div className="mt-1 text-xs text-red-400">{source.lastError}</div>}
              {source.runs?.[0] && <div className="mt-1 text-xs">Latest run: {source.runs[0].status} · {source.runs[0].itemsRead} read · {source.runs[0].itemsFailed} failed</div>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-white">1. Choose the vertical</CardTitle>
          <CardDescription className="text-gray-400">Same engine, different feed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(VERTICALS) as VerticalKey[]).map((v) => {
              const Icon = VERTICALS[v].icon
              return (
                <button key={v} onClick={() => selectVertical(v)} className={cn(toggle(vertical === v), "flex items-center gap-2")}>
                  <Icon className="h-4 w-4" /> {VERTICALS[v].label}
                </button>
              )
            })}
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-200">2. Choose how to import</label>
            <div className="grid gap-2 sm:grid-cols-3">
              <button onClick={() => { setMode("feed"); setInlineNotice(null); setPreview(null) }} className={toggle(mode === "feed")}>MLS/CRM feed</button>
              <button onClick={() => { setMode("single"); setInlineNotice(null); setPreview(null) }} className={toggle(mode === "single")}>
                {vertical === "realestate" ? "Single listing" : vertical === "automotive" ? "Single vehicle" : "Single product"}
              </button>
              <button onClick={() => { setMode("screenshots"); setInlineNotice(null); setPreview(null) }} className={toggle(mode === "screenshots")}>Import screenshots</button>
            </div>

            {mode === "feed" && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button onClick={() => setFeedKind("url")} className={toggle(feedKind === "url")}>Feed URL</button>
                  <button onClick={() => setFeedKind("paste")} className={toggle(feedKind === "paste")}>Paste data</button>
                </div>
                {feedKind === "url" ? (
                  <Input value={feedUrl} onChange={(e) => handleFeedUrl(e.target.value)}
                    placeholder="https://your-mls-or-crm.com/authorized-feed.json"
                    className="bg-black/30 border-white/10 text-white placeholder:text-gray-500" />
                ) : (
                  <>
                    <Textarea value={pasteText} onChange={(e) => { setPasteText(e.target.value); setPreview(null) }}
                      placeholder='Paste a JSON array of items, or click "Load sample".' rows={7}
                      className="bg-black/30 border-white/10 text-white placeholder:text-gray-500 font-mono text-xs" />
                    <Button variant="outline" size="sm" onClick={loadSample} className="border-white/15 text-gray-200">
                      Load sample ({cfg.label.toLowerCase()})
                    </Button>
                  </>
                )}
                <p className="text-xs text-amber-400/80">For authorized JSON/XML/CSV inventory feeds—not public detail pages. Local and private-network URLs are blocked for security.</p>
              </div>
            )}

            {(mode === "single" || mode === "screenshots") && (
              <div className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
                {mode === "screenshots" && (
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-orange-400/50 bg-orange-500/5 p-6 text-center">
                    {extracting ? <Loader2 className="mb-2 h-7 w-7 animate-spin text-orange-400" /> : <FileImage className="mb-2 h-7 w-7 text-orange-400" />}
                    <span className="font-medium text-white">{extracting ? "Reading screenshots…" : "Upload screenshots or a property flyer"}</span>
                    <span className="mt-1 text-xs text-gray-400">Up to 3 JPG, PNG, or WebP images. AI suggests fields; you review them.</span>
                    <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple
                      disabled={extracting || uploading} onChange={(e) => e.target.files && uploadFiles(e.target.files, true)} />
                  </label>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs text-gray-400">{vertical === "realestate" ? "Property address" : "Title"} *</label>
                    <Input value={itemTitle} onChange={(e) => { setItemTitle(e.target.value); setPreview(null) }}
                      placeholder={vertical === "realestate" ? "1925 Jadd St, Belton, TX 76513" : "2019 Chevrolet Silverado 1500"}
                      className="bg-black/30 border-white/10 text-white" />
                  </div>
                  <div><label className="mb-1 block text-xs text-gray-400">Price</label><Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$425,000" className="bg-black/30 border-white/10 text-white" /></div>
                  {vertical === "realestate" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="mb-1 block text-xs text-gray-400">Beds</label><Input type="number" min="0" value={beds} onChange={(e) => setBeds(e.target.value)} className="bg-black/30 border-white/10 text-white" /></div>
                      <div><label className="mb-1 block text-xs text-gray-400">Baths</label><Input type="number" min="0" step="0.5" value={baths} onChange={(e) => setBaths(e.target.value)} className="bg-black/30 border-white/10 text-white" /></div>
                    </div>
                  ) : vertical === "automotive" ? (
                    <div><label className="mb-1 block text-xs text-gray-400">Mileage</label><Input value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="62,000 mi" className="bg-black/30 border-white/10 text-white" /></div>
                  ) : null}
                  <div className="sm:col-span-2"><label className="mb-1 block text-xs text-gray-400">Description and highlights</label><Textarea rows={3} value={highlights} onChange={(e) => setHighlights(e.target.value)} className="bg-black/30 border-white/10 text-white" /></div>
                  <div><label className="mb-1 block text-xs text-gray-400">Agent / seller contact</label><Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Name · phone · email" className="bg-black/30 border-white/10 text-white" /></div>
                  <div><label className="mb-1 block text-xs text-gray-400">Original page (reference only)</label><Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" className="bg-black/30 border-white/10 text-white" /></div>
                  <div className="sm:col-span-2"><label className="mb-1 block text-xs text-gray-400">Authorized photo URLs (one per line)</label><Textarea rows={3} value={photoUrls} onChange={(e) => setPhotoUrls(e.target.value)} placeholder="https://your-cdn.com/photo-1.jpg" className="bg-black/30 border-white/10 text-white font-mono text-xs" /></div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-200 hover:bg-white/10">
                    {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    Upload authorized photos
                    <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple
                      disabled={uploading} onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
                  </label>
                  <span className="text-xs text-gray-400">{uploadedUrls.length} uploaded photo{uploadedUrls.length === 1 ? "" : "s"}</span>
                </div>
                {inlineNotice && <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">{inlineNotice}</div>}
                <p className="text-xs text-gray-500">Only upload content you own or are authorized to use. The original URL is stored as a reference; ForgeVid does not scrape blocked platforms.</p>
              </div>
            )}
            <p className="text-xs text-gray-500">{cfg.hint}</p>
          </div>

          <div className="flex flex-wrap gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-200 block">Aspect ratio</label>
              <div className="flex gap-2">{ASPECTS.map((a) => <button key={a} onClick={() => setAspect(a)} className={toggle(aspect === a)}>{a}</button>)}</div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-200 block">Seconds per video</label>
              <Input type="number" min={5} max={120} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 16)}
                className="w-28 bg-black/30 border-white/10 text-white" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-200 block">Voice</label>
              <div className="flex items-center gap-2">
                <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}
                  className="bg-black/30 border border-white/10 text-white rounded-lg px-3 py-2 text-sm min-w-[220px]">
                  {VOICES.map((v) => <option key={v.id} value={v.id} className="bg-gray-900">{v.name} — {v.description} ({v.gender})</option>)}
                </select>
                <VoicePreviewButton voiceId={voiceId} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-200 block">Captions</label>
              <select value={captionPreset} onChange={(e) => setCaptionPreset(e.target.value)}
                className="bg-black/30 border border-white/10 text-white rounded-lg px-3 py-2 text-sm">
                <option value="default" className="bg-gray-900">Standard</option>
                <option value="karaoke" className="bg-gray-900">Karaoke — word-by-word (Reels/TikTok)</option>
                <option value="large" className="bg-gray-900">Large</option>
                <option value="subtle" className="bg-gray-900">Subtle</option>
              </select>
            </div>
            {cfg.languages && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-200 block">Languages</label>
                <div className="flex gap-2">
                  <button onClick={() => setLangEn((x) => !x)} className={toggle(langEn)}>English</button>
                  <button onClick={() => setLangEs((x) => !x)} className={toggle(langEs)}>Español</button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button variant="outline" onClick={runPreview} disabled={previewing || generating} className="border-white/15 text-gray-200">
              {previewing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Checking…</> : <><Eye className="h-4 w-4 mr-2" /> Preview</>}
            </Button>
            <Button onClick={runGenerate} disabled={generating || previewing || !preview || !approvedByUser} className="bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-40">
              {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</> : <>{previewLabel} <ArrowRight className="h-4 w-4 ml-2" /></>}
            </Button>
            {!preview && <span className="text-xs text-gray-500">Preview first to see how many videos you'll create.</span>}
            {langBoth && preview && <span className="text-xs text-gray-400">Each item ×2 (EN + ES) — uses 2× quota.</span>}
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-gray-300">
            <input type="checkbox" className="mt-1" checked={approvedByUser} onChange={(e) => setApprovedByUser(e.target.checked)} />
            <span>I reviewed the preview and authorize ForgeVid to generate these drafts. ForgeVid will not publish them or message prospects; sharing remains a separate manual action.</span>
          </label>
        </CardContent>
      </Card>

      {error && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
            <div className="text-red-200 text-sm">{error}</div>
          </CardContent>
        </Card>
      )}

      {preview && !result && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2"><Eye className="h-5 w-5 text-orange-400" /> Found {preview.count} item{preview.count === 1 ? "" : "s"}</CardTitle>
            <CardDescription className="text-gray-400">Review, then generate — nothing has been rendered or charged yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-white/5">
              {preview.items.map((it, i) => (
                <div key={i} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-gray-200">{it.label}</span>
                  <span className="text-gray-500 font-mono text-xs">{it.photos} photo{it.photos === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              {result.started > 0 ? <CheckCircle2 className="h-5 w-5 text-green-400" /> : <AlertCircle className="h-5 w-5 text-red-400" />}
              {result.started > 0 ? `Started ${result.started} of ${result.results?.length ?? 0} videos` : "No videos were started"}
            </CardTitle>
            <CardDescription className="text-gray-400">
              {result.started > 0 ? `${result.message} — updating live as they render.` : "Fix the item errors below, preview again, and retry. No video was created."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {result.results?.map((r, i) => {
                const job = r.videoId ? jobs[r.videoId] : undefined
                const status = job?.status ?? (r.videoId ? "QUEUED" : "FAILED")
                const done = status === "COMPLETED"
                const failed = status === "FAILED" || status === "CANCELLED" || !r.videoId
                return (
                  <div key={i} className="flex gap-3 rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="w-24 h-14 rounded bg-black/40 shrink-0 overflow-hidden flex items-center justify-center">
                      {done && job?.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={job.thumbnail} alt="" className="w-full h-full object-cover" />
                      ) : failed ? (
                        <AlertCircle className="h-5 w-5 text-red-400" />
                      ) : (
                        <Loader2 className="h-5 w-5 text-gray-500 animate-spin" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-200 truncate">
                        {r.label}{r.language && <span className="text-gray-500 font-mono"> · {r.language.toUpperCase()}</span>}
                      </div>
                      {failed ? (
                        <Badge className="bg-red-500/15 text-red-300 border-red-500/30 mt-1">{r.error || "failed"}</Badge>
                      ) : done ? (
                        <Badge className="bg-green-500/15 text-green-300 border-green-500/30 mt-1">ready</Badge>
                      ) : (
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                          <Clock className="h-3 w-3" /> {status === "QUEUED" ? "queued" : `rendering ${job?.percent ?? 0}%`}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {result.started > 0 ? (
              <Link href="/dashboard/videos"><Button variant="outline" className="border-white/15 text-gray-200 mt-2">Watch them in My Videos <ArrowRight className="h-4 w-4 ml-2" /></Button></Link>
            ) : (
              <Button variant="outline" onClick={() => { setResult(null); setPreview(null); setApprovedByUser(false) }} className="border-white/15 text-gray-200 mt-2">Fix media and preview again</Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
