import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sendSupportTicketNotification } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();
    const { subject, description, priority, category } = body;

    if (!subject || !description) {
      return NextResponse.json({ error: 'Subject and description are required' }, { status: 400 });
    }

    const allowedPriorities = ['low', 'medium', 'high'];
    const allowedCategories = ['general', 'billing', 'technical', 'feature'];

    const normalizedSubject = String(subject).trim().slice(0, 200);
    const normalizedDescription = String(description).trim().slice(0, 5000);
    if (!normalizedSubject || !normalizedDescription) {
      return NextResponse.json({ error: 'Subject and description are required' }, { status: 400 });
    }

    const normalizedPriority = allowedPriorities.includes(priority) ? priority : 'medium';
    const normalizedCategory = allowedCategories.includes(category) ? category : 'general';
    const ticket = await prisma.supportTicket.create({
      data: {
        subject: normalizedSubject,
        description: normalizedDescription,
        priority: normalizedPriority,
        category: normalizedCategory,
        userId: session.user.id,
      },
    });

    const notified = await sendSupportTicketNotification({
      id: ticket.id,
      subject: normalizedSubject,
      description: normalizedDescription,
      priority: normalizedPriority,
      category: normalizedCategory,
      reporterName: session.user.name,
      reporterEmail: session.user.email,
    });

    return NextResponse.json({ success: true, ticketId: ticket.id, notified });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
  }
}
