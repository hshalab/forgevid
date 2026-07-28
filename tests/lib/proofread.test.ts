jest.mock('@/lib/ai/llm', () => ({
  llm: { chat: { completions: { create: jest.fn() } } },
  llmModel: jest.fn(() => 'test-model'),
  hasLlmKey: jest.fn(() => true),
}))

import { llm, hasLlmKey } from '@/lib/ai/llm'
import { proofreadLines } from '@/lib/proofread'

const mockCreate = llm.chat.completions.create as jest.Mock
const mockHasKey = hasLlmKey as jest.Mock

function completion(content: string) {
  return { choices: [{ message: { content } }] }
}

describe('proofreadLines', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHasKey.mockReturnValue(true)
  })

  it('applies Spanish accent corrections line-by-line', async () => {
    mockCreate.mockResolvedValue(completion('1. Este vehículo tiene financiación disponible\n2. Visítenos hoy'))
    const result = await proofreadLines(
      ['Este vehiculo tiene financiacion disponible', 'Visitenos hoy'],
      'es',
    )
    expect(result).toEqual(['Este vehículo tiene financiación disponible', 'Visítenos hoy'])
    expect(mockCreate.mock.calls[0][0].messages[0].content).toContain('Spanish proofreader')
    expect(mockCreate.mock.calls[0][0].temperature).toBe(0)
  })

  it('reverts any line whose correction dropped or changed a number — facts survive', async () => {
    mockCreate.mockResolvedValue(completion('1. Precio: $29,000 al mes\n2. Llámenos hoy'))
    const result = await proofreadLines(['Precio: $28,900 al mes', 'Llamenos hoy'], 'es')
    // Line 1 changed 28,900 -> 29,000: reverted. Line 2's accent fix survives.
    expect(result).toEqual(['Precio: $28,900 al mes', 'Llámenos hoy'])
  })

  it('keeps ALL originals when the reply has the wrong line count', async () => {
    mockCreate.mockResolvedValue(completion('1. only one line'))
    const lines = ['first', 'second']
    expect(await proofreadLines(lines, 'es')).toEqual(lines)
  })

  it('keeps originals when the LLM call fails — never blocks a render', async () => {
    mockCreate.mockRejectedValue(new Error('LLM down'))
    const lines = ['Hola mundo']
    expect(await proofreadLines(lines, 'es')).toEqual(lines)
  })

  it('is a no-op without an LLM key or with no lines', async () => {
    mockHasKey.mockReturnValue(false)
    expect(await proofreadLines(['x'], 'es')).toEqual(['x'])
    mockHasKey.mockReturnValue(true)
    expect(await proofreadLines([], 'es')).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
