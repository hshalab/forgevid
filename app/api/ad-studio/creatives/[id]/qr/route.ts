import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import QRCode from 'qrcode'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await props.params
  const creative = await prisma.adCreative.findFirst({
    where: {
      id,
      userId: session.user.id,
      rightsStatus: 'CONFIRMED',
      approvalStatus: 'APPROVED',
    },
    select: { id: true, revision: true, approvedRevision: true },
  })
  if (!creative || creative.approvedRevision !== creative.revision) {
    return NextResponse.json({ error: 'Only the current approved revision can have a public QR code' }, { status: 404 })
  }
  const origin = (process.env.NEXTAUTH_URL || 'https://www.forgevid.com').replace(/\/$/, '')
  const png = await QRCode.toBuffer(`${origin}/l/${creative.id}`, {
    type: 'png',
    width: 768,
    margin: 2,
    errorCorrectionLevel: 'H',
  })
  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="forgevid-${creative.id}-qr.png"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
