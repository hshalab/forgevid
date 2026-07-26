import { NextResponse } from 'next/server'
import { getFreshSessionUser, isAdminRole } from '@/lib/rbac'
import { providerReliabilityStats } from '@/lib/provider-reliability'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const user = await getFreshSessionUser()
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const pendingDeadLetters = await prisma.generationDeadLetter.count({ where: { status: 'PENDING' } })
  return NextResponse.json({ providers: providerReliabilityStats(), pendingDeadLetters })
}
