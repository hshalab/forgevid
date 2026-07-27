import { CircuitBreakerRegistry } from '@/lib/circuit-breaker'
import { providerBreaker, providerReliabilityStats, withProviderReliability } from '@/lib/provider-reliability'

describe('provider reliability', () => {
  beforeEach(() => {
    CircuitBreakerRegistry.resetAll()
  })

  it('opens a provider circuit after its failure threshold and rejects without calling upstream', async () => {
    const upstream = jest.fn().mockRejectedValue(new Error('provider unavailable'))

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(withProviderReliability('openai', upstream)).rejects.toThrow('provider unavailable')
    }

    expect(providerBreaker('openai').getStats().state).toBe('OPEN')
    await expect(withProviderReliability('openai', upstream)).rejects.toThrow('Circuit breaker provider:openai is OPEN')
    expect(upstream).toHaveBeenCalledTimes(3)
  })

  it('reports independent health for every supported provider', () => {
    const stats = providerReliabilityStats()
    expect(stats.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'provider:llm',
      'provider:openai',
      'provider:elevenlabs',
      'provider:pexels',
      'provider:heygen',
      'provider:cloudinary',
      'provider:runway',
    ]))
    expect(stats.every((entry) => entry.state === 'CLOSED')).toBe(true)
  })
})
