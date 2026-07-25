import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getFreshSessionUser, isAdminRole } from '@/lib/rbac'

const CATEGORIES = ['hosting', 'contractor', 'tooling', 'marketing_spend', 'other'] as const

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  description: z.string().min(1).max(300),
  amountCents: z.number().int().min(0).max(100_000_000),
  incurredOn: z.string().datetime(),
  notes: z.string().max(2000).optional().or(z.literal('')),
})

const updateSchema = z.object({
  id: z.string().min(1),
  category: z.enum(CATEGORIES).optional(),
  description: z.string().min(1).max(300).optional(),
  amountCents: z.number().int().min(0).max(100_000_000).optional(),
  incurredOn: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
})

const deleteSchema = z.object({ id: z.string().min(1) })

async function requireAdmin() {
  const user = await getFreshSessionUser()
  if (!user || !isAdminRole(user.role)) return null
  return user
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const costs = await prisma.operatingCost.findMany({
    where: { userId: admin.id },
    orderBy: { incurredOn: 'desc' },
  })
  return NextResponse.json({ costs })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const cost = await prisma.operatingCost.create({
    data: {
      userId: admin.id,
      category: parsed.data.category,
      description: parsed.data.description.trim(),
      amountCents: parsed.data.amountCents,
      incurredOn: new Date(parsed.data.incurredOn),
      notes: parsed.data.notes?.trim() || null,
    },
  })

  return NextResponse.json({ cost }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { id, incurredOn, ...rest } = parsed.data
  const existing = await prisma.operatingCost.findUnique({ where: { id }, select: { userId: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.userId !== admin.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const cost = await prisma.operatingCost.update({
    where: { id },
    data: { ...rest, ...(incurredOn !== undefined && { incurredOn: new Date(incurredOn) }) },
  })

  return NextResponse.json({ cost })
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const existing = await prisma.operatingCost.findUnique({ where: { id: parsed.data.id }, select: { userId: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.userId !== admin.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.operatingCost.delete({ where: { id: parsed.data.id } })
  return NextResponse.json({ success: true })
}
