import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const hostname = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(':')[0].toLowerCase()
  const domain = await prisma.campaignDomain.findFirst({
    where: { hostname, enabled: true, verifiedAt: { not: null }, defaultCreativeId: { not: null } },
    select: { defaultCreativeId: true },
  })
  if (!domain?.defaultCreativeId) return NextResponse.json({ error: 'Campaign domain is not configured' }, { status: 404 })
  return NextResponse.redirect(new URL(`/l/${domain.defaultCreativeId}`, request.url))
}
