import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { encryptSensitiveData } from '@/lib/encryption'
import { prisma } from '@/lib/prisma'

const sourceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  vertical: z.enum(['auto', 'realestate', 'ecom']),
  feedUrl: z.string().url().max(2048),
  authorizationBasis: z.string().trim().min(3).max(300),
  authorizationExpiresAt: z.string().datetime().nullable().optional(),
  fieldMapping: z.record(z.string(), z.string()).optional(),
  credentials: z.object({
    authorization: z.string().max(1000).optional(),
    apiKey: z.string().max(1000).optional(),
  }).optional(),
  scheduleEnabled: z.boolean().default(false),
  cadence: z.enum(['daily', 'weekly']).default('daily'),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const sources = await prisma.inventorySource.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, vertical: true, feedUrl: true, fieldMapping: true,
      authorizationBasis: true, authorizationExpiresAt: true, enabled: true,
      scheduleEnabled: true, cadence: true, nextRunAt: true, lastRunAt: true,
      lastSuccessAt: true, lastError: true, createdAt: true,
      runs: { orderBy: { startedAt: 'desc' }, take: 10 },
    },
  })
  return NextResponse.json({
    sources: sources.map((source) => ({
      ...source,
      fieldMapping: source.fieldMapping ? JSON.parse(source.fieldMapping) : {},
    })),
  })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const parsed = sourceSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid inventory source', details: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data
  const source = await prisma.inventorySource.create({
    data: {
      userId: session.user.id,
      name: input.name,
      vertical: input.vertical,
      feedUrl: input.feedUrl,
      authorizationBasis: input.authorizationBasis,
      authorizationExpiresAt: input.authorizationExpiresAt ? new Date(input.authorizationExpiresAt) : null,
      fieldMapping: input.fieldMapping ? JSON.stringify(input.fieldMapping) : null,
      credentialCiphertext: input.credentials && Object.values(input.credentials).some(Boolean)
        ? encryptSensitiveData(input.credentials)
        : null,
      scheduleEnabled: input.scheduleEnabled,
      cadence: input.cadence,
      nextRunAt: input.scheduleEnabled ? new Date() : null,
    },
    select: { id: true, name: true, vertical: true, feedUrl: true, scheduleEnabled: true, cadence: true },
  })
  return NextResponse.json({ source }, { status: 201 })
}
