import { CircuitBreakerRegistry } from './circuit-breaker'

export type ProviderName = 'llm' | 'openai' | 'elevenlabs' | 'pexels' | 'heygen' | 'cloudinary' | 'runway'

const settings: Record<ProviderName, { failureThreshold: number; recoveryTimeout: number; monitoringPeriod: number }> = {
  llm: { failureThreshold: 3, recoveryTimeout: 60_000, monitoringPeriod: 15_000 },
  openai: { failureThreshold: 3, recoveryTimeout: 60_000, monitoringPeriod: 15_000 },
  elevenlabs: { failureThreshold: 3, recoveryTimeout: 90_000, monitoringPeriod: 15_000 },
  pexels: { failureThreshold: 5, recoveryTimeout: 45_000, monitoringPeriod: 10_000 },
  heygen: { failureThreshold: 3, recoveryTimeout: 120_000, monitoringPeriod: 20_000 },
  cloudinary: { failureThreshold: 4, recoveryTimeout: 60_000, monitoringPeriod: 15_000 },
  runway: { failureThreshold: 3, recoveryTimeout: 120_000, monitoringPeriod: 20_000 },
}

export function providerBreaker(provider: ProviderName) {
  return CircuitBreakerRegistry.getOrCreate(`provider:${provider}`, settings[provider])
}

export function withProviderReliability<T>(provider: ProviderName, operation: () => Promise<T>) {
  return providerBreaker(provider).execute(operation)
}

export function providerReliabilityStats() {
  return (Object.keys(settings) as ProviderName[]).map((provider) => providerBreaker(provider).getStats())
}
