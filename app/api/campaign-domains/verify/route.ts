import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { resolveTxt } from 'dns/promises'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const parsed = z.object({ id: z.string() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid domain' }, { status: 400 })
  const domain = await prisma.campaignDomain.findFirst({ where: { id: parsed.data.id, userId: session.user.id } })
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const records = await resolveTxt(`_forgevid.${domain.hostname}`).catch(() => [])
  if (!records.some((parts) => parts.join('') === domain.verificationToken)) {
    return NextResponse.json({ error: 'Verification TXT record not found yet' }, { status: 422 })
  }
  const verified = await prisma.campaignDomain.update({ where: { id: domain.id }, data: { verifiedAt: new Date() } })
  return NextResponse.json({ domain: verified, routing: 'Point this hostname to the ForgeVid Railway service after verification.' })
}
