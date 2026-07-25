/**
 * Shared shapes for the Ad Studio UI. Mirrors the API contracts in
 * app/api/ad-studio/* and app/api/campaigns/variations — see those routes for
 * the source of truth.
 */

export interface AdHook {
  label: string
  narration: string
  searchQuery?: string
}

export interface AdCta {
  label: string
  narration: string
}

export interface HooksResponse {
  hooks: AdHook[]
  ctas: AdCta[]
  angles: string[]
  platform: string
}

export interface VariantAxes {
  hook?: string
  cta?: string
  aspect?: string
}

export interface VariantResult {
  label: string
  aspectRatio: string
  axes: VariantAxes
  videoId?: string
  error?: string
}

/** A persisted ad creative, as returned by the campaigns + creatives GETs. */
export interface CreativeRow {
  id: string
  label: string
  hook?: string | null
  cta?: string | null
  aspect?: string | null
  videoId?: string | null
  isWinner: boolean
  roas?: number | null
  status?: string | null
  url?: string | null
  thumbnail?: string | null
  evidence?: {
    strength: "insufficient" | "directional" | "confirmed"
    views: number
    leads: number
    downstreamConversions: number
    revenueCents: number
  }
}

/** A CreativeRow plus the campaign context returned only by the winners feed. */
export interface WinnerCreativeRow extends CreativeRow {
  platform: string
  notes?: string | null
  campaignId: string
  campaignName: string | null
  brief: string | null
}

export interface CampaignRow {
  id: string
  name: string
  brief: string
  platform: string
  createdAt: string
  creatives: CreativeRow[]
}
