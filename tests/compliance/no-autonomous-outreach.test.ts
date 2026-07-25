import { describe, it, expect } from '@jest/globals'
import fs from 'fs'
import path from 'path'

/**
 * Codifies the manual audit in evidence/PROVENANCE.md (COMP-003): ForgeVid
 * must never post to a social platform or email a prospect/lead directly
 * without a human in the loop. This is a static source scan, not a mock —
 * it fails the moment someone wires up real autonomous outreach, which is
 * the point.
 */

const ROOTS = ['app', 'lib', 'scripts'].map((dir) => path.join(process.cwd(), dir))

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const SOURCE_FILES = ROOTS.flatMap((root) => walk(root))

// Known social-platform posting/publishing endpoints. Reading follower counts
// or OAuth login is fine; anything that *publishes* content is not, until a
// human-approval gate (COMP-003) is built around it.
const SOCIAL_PUBLISH_HOSTS = [
  'graph.facebook.com',
  'graph.instagram.com',
  'api.twitter.com',
  'api.x.com',
  'open.tiktokapis.com',
  'business-api.tiktok.com',
]

describe('no autonomous social publishing', () => {
  it('has at least one source file to scan (guards against a broken walk)', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(20)
  })

  it.each(SOCIAL_PUBLISH_HOSTS)('never references %s', (host) => {
    const offenders = SOURCE_FILES.filter((file) => fs.readFileSync(file, 'utf8').includes(host))
    expect(offenders).toEqual([])
  })
})

describe('no autonomous prospect messaging', () => {
  it('marketing-batch.ts sends clips to the operator inbox, not a business contact', () => {
    const file = path.join(process.cwd(), 'scripts', 'marketing-batch.ts')
    const source = fs.readFileSync(file, 'utf8')
    // The only send site must target opts.email (operator-controlled), never a
    // brand/topic/prospect-derived field.
    expect(source).toMatch(/await emailClip\(opts\.email,/)
    expect(source).not.toMatch(/await emailClip\((?!opts\.email)/)
  })

  it('prospect-sample.ts sends the generated sample to the operator inbox, not the prospect', () => {
    const file = path.join(process.cwd(), 'scripts', 'prospect-sample.ts')
    const source = fs.readFileSync(file, 'utf8')
    expect(source).toMatch(/await emailSample\(opts\.email,/)
    expect(source).not.toMatch(/await emailSample\((?!opts\.email)/)
  })
})
