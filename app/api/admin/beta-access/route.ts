import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/rbac'
import { getStoredBetaAccessEntries, isBetaModeEnabled } from '@/lib/beta-access'

const createEntrySchema = z.object({
  email: z.string().email().max(255).optional().or(z.literal('')),
  inviteCode: z.string().max(128).optional().or(z.literal('')),
  note: z.string().max(500).optional().or(z.literal('')),
})

const updateEntrySchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean().optional(),
  note: z.string().max(500).optional(),
})

const deleteEntrySchema = z.object({
  id: z.string().min(1),
})

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const entries = await getStoredBetaAccessEntries()

  return NextResponse.json({
    betaModeEnabled: isBetaModeEnabled(),
    entries,
  })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = createEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = parsed.data.email?.trim().toLowerCase() || null
  const inviteCode = parsed.data.inviteCode?.trim() || null
  const note = parsed.data.note?.trim() || null

  if (!email && !inviteCode) {
    return NextResponse.json({ error: 'Provide an email or an invite code' }, { status: 400 })
  }

  if (email) {
    const existingByEmail = await prisma.betaAccessEntry.findUnique({ where: { email } })
    if (existingByEmail) {
      return NextResponse.json({ error: 'This email is already in beta access rules' }, { status: 409 })
    }
  }

  if (inviteCode) {
    const existingByInvite = await prisma.betaAccessEntry.findUnique({ where: { inviteCode } })
    if (existingByInvite) {
      return NextResponse.json({ error: 'This invite code already exists' }, { status: 409 })
    }
  }

  const entry = await prisma.betaAccessEntry.create({
    data: {
      email,
      inviteCode,
      note,
      createdById: admin.id,
    },
    select: {
      id: true,
      email: true,
      inviteCode: true,
      note: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      createdById: true,
      createdBy: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  })

  return NextResponse.json({ entry }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = updateEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const existing = await prisma.betaAccessEntry.findUnique({ where: { id: parsed.data.id } })
  if (!existing) {
    return NextResponse.json({ error: 'Beta access entry not found' }, { status: 404 })
  }

  const entry = await prisma.betaAccessEntry.update({
    where: { id: parsed.data.id },
    data: {
      isActive: parsed.data.isActive ?? existing.isActive,
      note: parsed.data.note ?? existing.note,
    },
    select: {
      id: true,
      email: true,
      inviteCode: true,
      note: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      createdById: true,
      createdBy: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  })

  return NextResponse.json({ entry })
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = deleteEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  await prisma.betaAccessEntry.delete({ where: { id: parsed.data.id } })
  return NextResponse.json({ success: true })
}
