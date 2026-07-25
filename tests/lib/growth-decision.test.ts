import { buildGrowthDecisionPrompt, parseGrowthDecision } from '@/lib/growth-decision'

const opportunity = {
  itemId: 'item-1',
  externalRef: 'VIN-123',
  label: '2020 Honda Civic',
  vertical: 'auto',
  priceText: '$19,900',
  daysInInventory: 42,
  priceChangedSinceLastVideo: false,
  hasRecentVideo: false,
  isNewArrival: false,
  score: 72,
  reasons: ['42 days in inventory', 'never had a video made'],
}

describe('Growth Operator structured decisions', () => {
  it('puts only observed inventory evidence into the prompt', () => {
    const prompt = buildGrowthDecisionPrompt(opportunity)
    expect(prompt).toContain('42 days in inventory')
    expect(prompt).toContain('never had a video made')
    expect(prompt).toContain('Never invent')
  })

  it('accepts a fenced, valid bilingual Gemini decision', () => {
    const decision = parseGrowthDecision(
      `\`\`\`json
      {
        "inventoryItemId":"item-1",
        "reason":"This vehicle has been tracked for 42 days and has never had a video.",
        "targetAudience":"Local shoppers comparing practical used vehicles",
        "languages":["en","es"],
        "aspectRatio":"9:16",
        "salesAngle":"Practical inventory spotlight grounded in the listing facts",
        "templateStrategy":"Fast inventory showcase with clear feature cards",
        "voiceStyle":"Warm and concise",
        "callToAction":"Contact the dealer for current availability",
        "evidenceUsed":["42 days in inventory","never had a video made"],
        "testNext":"Compare English and Spanish completion rates",
        "confidence":"medium",
        "variants":[
          {"language":"en","hookLabel":"Practical value","hookNarration":"A practical Civic ready for your next drive.","ctaLabel":"Check availability","ctaNarration":"Contact the dealer for current availability."},
          {"language":"en","hookLabel":"Inventory spotlight","hookNarration":"This Civic deserves a closer look today.","ctaLabel":"Check availability","ctaNarration":"Contact the dealer for current availability."},
          {"language":"es","hookLabel":"Valor práctico","hookNarration":"Un Civic práctico listo para tu próximo viaje.","ctaLabel":"Ver disponibilidad","ctaNarration":"Contacta al dealer para confirmar disponibilidad."},
          {"language":"es","hookLabel":"Auto destacado","hookNarration":"Este Civic merece que lo conozcas hoy.","ctaLabel":"Ver disponibilidad","ctaNarration":"Contacta al dealer para confirmar disponibilidad."}
        ]
      }\`\`\``,
      'item-1',
    )
    expect(decision.languages).toEqual(['en', 'es'])
    expect(decision.aspectRatio).toBe('9:16')
  })

  it('rejects a decision that switches to another inventory item', () => {
    const raw = JSON.stringify({
      inventoryItemId: 'item-2',
      reason: 'This is a sufficiently detailed grounded recommendation.',
      targetAudience: 'Local buyers',
      languages: ['en'],
      aspectRatio: '9:16',
      salesAngle: 'Inventory spotlight',
      templateStrategy: 'Fast showcase',
      voiceStyle: 'Warm and concise',
      callToAction: 'Contact the business',
      evidenceUsed: ['42 days in inventory'],
      testNext: 'Test a second hook',
      confidence: 'medium',
      variants: [
        { language: 'en', hookLabel: 'One', hookNarration: 'A sufficiently long hook.', ctaLabel: 'Act', ctaNarration: 'Contact the business today.' },
        { language: 'en', hookLabel: 'Two', hookNarration: 'Another sufficiently long hook.', ctaLabel: 'Act', ctaNarration: 'Contact the business today.' },
      ],
    })
    expect(() => parseGrowthDecision(raw, 'item-1')).toThrow(/not requested/)
  })

  it('requires two distinct variants for every selected language', () => {
    const raw = JSON.stringify({
      inventoryItemId: 'item-1',
      reason: 'This is a sufficiently detailed grounded recommendation.',
      targetAudience: 'Local buyers',
      languages: ['en', 'es'],
      aspectRatio: '9:16',
      salesAngle: 'Inventory spotlight',
      templateStrategy: 'Fast showcase',
      voiceStyle: 'Warm and concise',
      callToAction: 'Contact the business',
      evidenceUsed: ['42 days in inventory'],
      testNext: 'Test a second hook',
      confidence: 'medium',
      variants: [
        { language: 'en', hookLabel: 'One', hookNarration: 'A sufficiently long hook.', ctaLabel: 'Act', ctaNarration: 'Contact the business today.' },
        { language: 'en', hookLabel: 'Two', hookNarration: 'Another sufficiently long hook.', ctaLabel: 'Act', ctaNarration: 'Contact the business today.' },
      ],
    })
    expect(() => parseGrowthDecision(raw, 'item-1')).toThrow(/ES hooks/)
  })
})
