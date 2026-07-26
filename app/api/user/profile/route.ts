import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/** Bio lives inside the User.metadata JSON blob — there is no dedicated column. */
function readBio(metadata: string | null): string {
  if (!metadata) return ''
  try {
    const parsed = JSON.parse(metadata)
    return typeof parsed?.bio === 'string' ? parsed.bio : ''
  } catch {
    return ''
  }
}
const LANGUAGES = new Set(['en', 'es', 'hi', 'zh', 'ja', 'fr', 'it', 'ko', 'pt', 'de'])
function readMetadata(metadata: string | null): Record<string, any> {
  try { return metadata ? JSON.parse(metadata) : {} } catch { return {} }
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, image: true, metadata: true },
  })
  if (!user) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      bio: readBio(user.metadata),
      preferences: readMetadata(user.metadata).preferences ?? { language: 'en' },
    },
  })
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const data: { name?: string; image?: string | null; metadata?: string } = {}

  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (name.length < 1 || name.length > 80) {
      return NextResponse.json({ error: 'Name must be between 1 and 80 characters' }, { status: 400 })
    }
    data.name = name
  }

  if (body.image !== undefined) {
    const image = String(body.image).trim()
    if (image.length > 2048) {
      return NextResponse.json({ error: 'Image URL is too long' }, { status: 400 })
    }
    data.image = image.length ? image : null
  }

  if (body.bio !== undefined) {
    const bio = String(body.bio)
    if (bio.length > 500) {
      return NextResponse.json({ error: 'Bio must be 500 characters or fewer' }, { status: 400 })
    }
    // Merge into the metadata JSON blob so we don't clobber other keys.
    const current = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { metadata: true },
    })
    let meta: Record<string, unknown> = {}
    try {
      meta = current?.metadata ? JSON.parse(current.metadata) : {}
    } catch {
      meta = {}
    }
    meta.bio = bio
    data.metadata = JSON.stringify(meta)
  }

  if (body.preferences !== undefined) {
    const preferences = body.preferences as Record<string, unknown>
    const language = String(preferences?.language || '')
    const timezone = String(preferences?.timezone || 'UTC')
    if (!LANGUAGES.has(language) || timezone.length > 80) {
      return NextResponse.json({ error: 'Invalid preferences' }, { status: 400 })
    }
    const current = await prisma.user.findUnique({ where: { id: session.user.id }, select: { metadata: true } })
    const meta = readMetadata(data.metadata ?? current?.metadata ?? null)
    meta.preferences = {
      language,
      timezone,
      theme: ['light', 'dark', 'system'].includes(String(preferences.theme)) ? preferences.theme : 'system',
      autoSave: preferences.autoSave !== false,
      qualityPreference: ['low', 'medium', 'high'].includes(String(preferences.qualityPreference))
        ? preferences.qualityPreference
        : 'high',
    }
    data.metadata = JSON.stringify(meta)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { id: true, name: true, email: true, image: true, metadata: true },
  })

  return NextResponse.json({
    ok: true,
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      image: updated.image,
      bio: readBio(updated.metadata),
      preferences: readMetadata(updated.metadata).preferences ?? { language: 'en' },
    },
  })
}
