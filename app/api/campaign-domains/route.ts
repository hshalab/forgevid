import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const hostSchema = z.string().trim().toLowerCase().regex(/^(?=.{4,253}$)(?!-)(?:[a-z0-9-]+\.)+[a-z]{2,}$/)

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const domains = await prisma.campaignDomain.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ domains: domains.map((domain) => ({
    ...domain,
    dns: { type: 'TXT', name: `_forgevid.${domain.hostname}`, value: domain.verificationToken },
  })) })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const parsed = z.object({ hostname: hostSchema, defaultCreativeId: z.string() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid campaign domain' }, { status: 400 })
  const creative = await prisma.adCreative.findFirst({
    where: { id: parsed.data.defaultCreativeId, userId: session.user.id, approvalStatus: 'APPROVED' },
    select: { id: true },
  })
  if (!creative) return NextResponse.json({ error: 'Creative not found' }, { status: 404 })
  const domain = await prisma.campaignDomain.create({
    data: {
      userId: session.user.id, hostname: parsed.data.hostname,
      defaultCreativeId: creative.id, verificationToken: `forgevid=${randomBytes(24).toString('hex')}`,
    },
  })
  return NextResponse.json({ domain, dns: { type: 'TXT', name: `_forgevid.${domain.hostname}`, value: domain.verificationToken } }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const result = await prisma.campaignDomain.deleteMany({ where: { id, userId: session.user.id } })
  return result.count ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
