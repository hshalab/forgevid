import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { deleteCloudinaryUrl } from '@/lib/cloudinary'

// DELETE a single video the caller owns. Used by the My Videos library.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ videoId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const video = await prisma.video.findUnique({
    where: { id: params.videoId },
    select: { id: true, userId: true, url: true, fileUrl: true, thumbnail: true },
  })
  if (!video) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (video.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await deleteCloudinaryUrl(video.fileUrl || video.url, 'video')
  await deleteCloudinaryUrl(video.thumbnail, 'image')
  await prisma.video.delete({ where: { id: params.videoId } })
  return NextResponse.json({ ok: true })
}
