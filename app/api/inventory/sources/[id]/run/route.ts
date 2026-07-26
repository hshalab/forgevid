import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runInventorySource } from '@/lib/inventory-source-runner'
import { prisma } from '@/lib/prisma'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  const source = await prisma.inventorySource.findFirst({ where: { id, userId: session.user.id, enabled: true } })
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await runInventorySource(source))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Import failed' }, { status: 422 })
  }
}
