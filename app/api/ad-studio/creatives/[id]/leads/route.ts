import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// GET — leads captured on this creative's public landing page (app/l/[id]).
// Owner only, same ownership check as the PATCH handler next to this file.
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const creative = await prisma.adCreative.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true },
  })
  if (!creative) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (creative.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const events = await prisma.creativeEvent.findMany({
    where: { creativeId: creative.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, kind: true, name: true, email: true, phone: true, message: true, createdAt: true },
  })

  const views = events.filter((e) => e.kind === 'view').length
  const leads = events.filter((e) => e.kind === 'lead_submitted')

  return NextResponse.json({ views, leads })
}
