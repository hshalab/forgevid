import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { encryptSensitiveData } from '@/lib/encryption'
import { prisma } from '@/lib/prisma'

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  scheduleEnabled: z.boolean().optional(),
  cadence: z.enum(['daily', 'weekly']).optional(),
  authorizationBasis: z.string().trim().min(3).max(300).optional(),
  authorizationExpiresAt: z.string().datetime().nullable().optional(),
  fieldMapping: z.record(z.string(), z.string()).optional(),
  credentials: z.object({ authorization: z.string().max(1000).optional(), apiKey: z.string().max(1000).optional() }).optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  const owned = await prisma.inventorySource.findFirst({ where: { id, userId: session.user.id }, select: { id: true } })
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid source update' }, { status: 400 })
  const input = parsed.data
  const source = await prisma.inventorySource.update({
    where: { id },
    data: {
      enabled: input.enabled,
      scheduleEnabled: input.scheduleEnabled,
      cadence: input.cadence,
      nextRunAt: input.scheduleEnabled === true ? new Date() : input.scheduleEnabled === false ? null : undefined,
      authorizationBasis: input.authorizationBasis,
      authorizationExpiresAt: input.authorizationExpiresAt === undefined ? undefined : input.authorizationExpiresAt ? new Date(input.authorizationExpiresAt) : null,
      fieldMapping: input.fieldMapping ? JSON.stringify(input.fieldMapping) : undefined,
      credentialCiphertext: input.credentials ? encryptSensitiveData(input.credentials) : undefined,
    },
    select: { id: true, enabled: true, scheduleEnabled: true, cadence: true, nextRunAt: true },
  })
  return NextResponse.json({ source })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  const result = await prisma.inventorySource.deleteMany({ where: { id, userId: session.user.id } })
  return result.count ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
