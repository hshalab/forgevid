import { decryptSensitiveData } from './encryption'
import { parseListingsFeed } from './mls-feed'
import { parseProductFeed } from './product-feed'
import { prisma } from './prisma'
import { safeFetch } from './safe-fetch'
import { recordInventorySnapshot, type Vertical } from './inventory'
import { parseVehicleFeed } from './vehicle-feed'

type Source = {
  id: string
  userId: string
  vertical: string
  feedUrl: string
  credentialCiphertext: string | null
  fieldMapping: string | null
  authorizationExpiresAt: Date | null
}

function credentialHeaders(ciphertext: string | null): Record<string, string> {
  if (!ciphertext) return {}
  const credentials = decryptSensitiveData(ciphertext) as Record<string, unknown>
  const headers: Record<string, string> = {}
  if (typeof credentials.authorization === 'string') headers.Authorization = credentials.authorization
  if (typeof credentials.apiKey === 'string') headers['x-api-key'] = credentials.apiKey
  return headers
}

function applyJsonMapping(body: string, mappingText: string | null): string {
  if (!mappingText) return body
  const mapping = JSON.parse(mappingText) as Record<string, string>
  const parsed = JSON.parse(body)
  const mapRecord = (record: unknown) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record
    const source = record as Record<string, unknown>
    return Object.fromEntries(Object.entries(mapping).map(([target, field]) => [target, source[field]]))
  }
  if (Array.isArray(parsed)) return JSON.stringify(parsed.map(mapRecord))
  for (const key of ['value', 'vehicles', 'listings', 'products', 'items']) {
    if (Array.isArray(parsed?.[key])) return JSON.stringify({ ...parsed, [key]: parsed[key].map(mapRecord) })
  }
  return body
}

export async function runInventorySource(source: Source) {
  const run = await prisma.inventoryImportRun.create({ data: { sourceId: source.id } })
  try {
    if (source.authorizationExpiresAt && source.authorizationExpiresAt <= new Date()) {
      throw new Error('Source authorization has expired')
    }
    const fetched = await safeFetch(source.feedUrl, {
      maxBytes: 10 * 1024 * 1024,
      timeoutMs: 20_000,
      headers: credentialHeaders(source.credentialCiphertext),
      acceptTypes: ['application/json', 'application/xml', 'text/xml', 'text/csv', 'text/plain'],
    })
    let text = fetched.body.toString('utf8')
    if (/json/i.test(fetched.contentType)) text = applyJsonMapping(text, source.fieldMapping)
    const vertical = source.vertical as Vertical
    const items = vertical === 'auto'
      ? parseVehicleFeed(text, fetched.contentType).map((item) => ({ ref: item.ref, label: item.title, price: item.price, photos: item.photos }))
      : vertical === 'realestate'
        ? parseListingsFeed(text, fetched.contentType).map((item) => ({ ref: item.ref, label: item.address, price: item.price, photos: item.photos }))
        : parseProductFeed(text, fetched.contentType).map((item) => ({ ref: item.ref, label: item.title, price: item.price, photos: item.photos }))

    const errors: Array<{ ref: string; error: string }> = []
    for (const item of items) {
      try {
        await recordInventorySnapshot({
          userId: source.userId,
          vertical,
          externalRef: item.ref,
          label: item.label,
          priceText: item.price,
          photoCount: item.photos.length,
        })
        await Promise.all(item.photos.map((assetUrl) => prisma.inventoryAssetAuthorization.upsert({
          where: { userId_assetUrl: { userId: source.userId, assetUrl } },
          update: { sourceUrl: source.feedUrl, authorizationBasis: 'authorized-feed', revokedAt: null, expiresAt: source.authorizationExpiresAt },
          create: {
            userId: source.userId,
            assetUrl,
            sourceUrl: source.feedUrl,
            authorizationBasis: 'authorized-feed',
            expiresAt: source.authorizationExpiresAt,
          },
        })))
      } catch (error) {
        errors.push({ ref: item.ref, error: error instanceof Error ? error.message.slice(0, 500) : 'Import failed' })
      }
    }
    const now = new Date()
    await prisma.$transaction([
      prisma.inventoryImportRun.update({
        where: { id: run.id },
        data: {
          status: errors.length ? 'PARTIAL' : 'SUCCEEDED',
          itemsRead: items.length,
          itemsValid: items.length - errors.length,
          itemsFailed: errors.length,
          errorArchive: errors.length ? JSON.stringify(errors) : null,
          finishedAt: now,
        },
      }),
      prisma.inventorySource.update({
        where: { id: source.id },
        data: { lastRunAt: now, lastSuccessAt: now, lastError: errors[0]?.error ?? null },
      }),
    ])
    return { runId: run.id, status: errors.length ? 'PARTIAL' : 'SUCCEEDED', itemsRead: items.length, itemsFailed: errors.length }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Import failed'
    await prisma.$transaction([
      prisma.inventoryImportRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', itemsFailed: 1, errorArchive: JSON.stringify([{ error: message }]), finishedAt: new Date() },
      }),
      prisma.inventorySource.update({ where: { id: source.id }, data: { lastRunAt: new Date(), lastError: message } }),
    ])
    throw error
  }
}
