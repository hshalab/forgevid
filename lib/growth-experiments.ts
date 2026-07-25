export type EvidenceStrength = 'insufficient' | 'directional' | 'confirmed'

export interface ExperimentEvidence {
  views: number
  leads: number
  downstreamConversions: number
  revenueCents: number
}

export function classifyEvidence(evidence: ExperimentEvidence): EvidenceStrength {
  if (evidence.views < 100 || evidence.leads < 3) return 'insufficient'
  if (evidence.views < 500 || evidence.leads < 20 || evidence.downstreamConversions < 3) return 'directional'
  return 'confirmed'
}

export function evidenceLabel(evidence: ExperimentEvidence): string {
  const strength = classifyEvidence(evidence)
  const rate = evidence.views > 0 ? ((evidence.leads / evidence.views) * 100).toFixed(1) : '0.0'
  return [
    `${strength.toUpperCase()} evidence`,
    `${evidence.views} tracked views`,
    `${evidence.leads} captured leads (${rate}%)`,
    `${evidence.downstreamConversions} customer-recorded downstream outcomes`,
    `$${(evidence.revenueCents / 100).toFixed(2)} customer-recorded revenue`,
  ].join('; ')
}
