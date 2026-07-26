import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const authorizationSchema = z.object({
  assetUrl: z.string().url().max(2048),
  sourceUrl: z.string().url().max(2048).nullable().optional(),
  inventoryItemId: z.string().nullable().optional(),
  authorizationBasis: z.string().trim().min(3).max(300),
  authorizedBy: z.string().trim().max(120).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const authorizations = await prisma.inventoryAssetAuthorization.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  return NextResponse.json({ authorizations })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const parsed = authorizationSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid asset authorization' }, { status: 400 })
  const input = parsed.data
  const authorization = await prisma.inventoryAssetAuthorization.upsert({
    where: { userId_assetUrl: { userId: session.user.id, assetUrl: input.assetUrl } },
    update: {
      sourceUrl: input.sourceUrl,
      inventoryItemId: input.inventoryItemId,
      authorizationBasis: input.authorizationBasis,
      authorizedBy: input.authorizedBy,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      revokedAt: null,
    },
    create: {
      userId: session.user.id,
      assetUrl: input.assetUrl,
      sourceUrl: input.sourceUrl,
      inventoryItemId: input.inventoryItemId,
      authorizationBasis: input.authorizationBasis,
      authorizedBy: input.authorizedBy,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    },
  })
  return NextResponse.json({ authorization }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const body = z.object({ id: z.string(), revoked: z.boolean() }).safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid authorization update' }, { status: 400 })
  const owned = await prisma.inventoryAssetAuthorization.findFirst({ where: { id: body.data.id, userId: session.user.id } })
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const authorization = await prisma.inventoryAssetAuthorization.update({
    where: { id: owned.id },
    data: { revokedAt: body.data.revoked ? new Date() : null },
  })
  return NextResponse.json({ authorization })
}
