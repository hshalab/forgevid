import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdminRole, getFreshSessionUser } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

const schema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/),
  percentOff: z.number().int().min(1).max(100).optional(),
  amountOffCents: z.number().int().min(50).max(100_000).optional(),
  currency: z.string().length(3).default('usd'),
  maxRedemptions: z.number().int().min(1).max(100_000).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).refine((value) => Boolean(value.percentOff) !== Boolean(value.amountOffCents), {
  message: 'Provide exactly one discount type',
})

async function admin() {
  const user = await getFreshSessionUser()
  return user && isAdminRole(user.role) ? user : null
}

export async function GET() {
  if (!await admin()) return NextResponse.json({ error: 'Admin required' }, { status: 403 })
  return NextResponse.json({ discounts: await prisma.discountCode.findMany({ orderBy: { createdAt: 'desc' } }) })
}

export async function POST(request: NextRequest) {
  const user = await admin()
  if (!user) return NextResponse.json({ error: 'Admin required' }, { status: 403 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid discount code' }, { status: 400 })
  const input = parsed.data
  const coupon = await stripe.coupons.create({
    ...(input.percentOff ? { percent_off: input.percentOff } : { amount_off: input.amountOffCents, currency: input.currency }),
    duration: 'once',
    name: `ForgeVid ${input.code.toUpperCase()}`,
    max_redemptions: input.maxRedemptions ?? undefined,
    redeem_by: input.expiresAt ? Math.floor(new Date(input.expiresAt).getTime() / 1000) : undefined,
  })
  const discount = await prisma.discountCode.create({
    data: {
      code: input.code.toUpperCase(), stripeCouponId: coupon.id,
      percentOff: input.percentOff, amountOffCents: input.amountOffCents,
      currency: input.currency, maxRedemptions: input.maxRedemptions,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, createdBy: user.id,
    },
  })
  return NextResponse.json({ discount }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  if (!await admin()) return NextResponse.json({ error: 'Admin required' }, { status: 403 })
  const parsed = z.object({ id: z.string(), active: z.boolean() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid update' }, { status: 400 })
  const discount = await prisma.discountCode.update({ where: { id: parsed.data.id }, data: { active: parsed.data.active } })
  return NextResponse.json({ discount })
}
