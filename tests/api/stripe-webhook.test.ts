jest.mock('next/server', () => {
  class MockNextRequest {
    private _text: string
    headers: Map<string, string>

    constructor(body: string) {
      this._text = body
      this.headers = new Map()
    }

    async text() {
      return this._text
    }
  }

  class MockNextResponse {
    status: number
    private _body: any

    constructor(body: any, init: { status?: number } = {}) {
      this._body = body
      this.status = init.status ?? 200
    }

    static json(body: any, init: { status?: number } = {}) {
      return new MockNextResponse(body, init)
    }

    async json() {
      return this._body
    }
  }

  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse }
})

jest.mock('next/headers', () => ({
  headers: jest.fn(),
}))

jest.mock('@/lib/stripe', () => ({
  stripe: { webhooks: { constructEvent: jest.fn() } },
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    subscription: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    payment: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}))

jest.mock('@/lib/email', () => ({
  sendSubscriptionReceiptEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionCancelledEmail: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/credits', () => ({
  grantCredits: jest.fn().mockResolvedValue(undefined),
}))

import { NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { POST } from '@/app/api/webhooks/stripe/route'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

const mockedHeaders = headers as jest.MockedFunction<typeof headers>
const mockedConstructEvent = stripe.webhooks.constructEvent as jest.MockedFunction<typeof stripe.webhooks.constructEvent>
const mockedSubscription = prisma.subscription as jest.Mocked<typeof prisma.subscription>
const mockedPayment = prisma.payment as jest.Mocked<typeof prisma.payment>

function reqWithSignature(sig: string | null) {
  mockedHeaders.mockResolvedValue({ get: () => sig } as any)
  return new NextRequest('{}')
}

describe('Stripe webhook — signature verification', () => {
  beforeEach(() => jest.clearAllMocks())

  it('rejects a request with no stripe-signature header', async () => {
    const response = await POST(reqWithSignature(null))
    expect(response.status).toBe(400)
    expect(mockedConstructEvent).not.toHaveBeenCalled()
  })

  it('rejects a request whose signature fails verification', async () => {
    mockedConstructEvent.mockImplementation(() => {
      throw new Error('signature mismatch')
    })
    const response = await POST(reqWithSignature('bad-sig'))
    expect(response.status).toBe(400)
    expect(mockedPayment.create).not.toHaveBeenCalled()
  })
})

describe('Stripe webhook — checkout.session.completed links the Stripe subscription id', () => {
  beforeEach(() => jest.clearAllMocks())

  it('stores stripeSubscriptionId/stripeCustomerId in metadata when creating a new Subscription', async () => {
    mockedConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          client_reference_id: 'user-1',
          metadata: { planId: 'pro' },
          subscription: 'sub_new123',
          customer: 'cus_new456',
        },
      },
    } as any)
    mockedSubscription.findFirst.mockResolvedValue(null)
    mockedSubscription.create.mockResolvedValue({} as any)

    const response = await POST(reqWithSignature('good-sig'))

    expect(response.status).toBe(200)
    expect(mockedSubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: JSON.stringify({ stripeSubscriptionId: 'sub_new123', stripeCustomerId: 'cus_new456' }),
        }),
      }),
    )
  })

  it('also stores it when updating an existing Subscription row (plan change / re-checkout)', async () => {
    mockedConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          client_reference_id: 'user-1',
          metadata: { planId: 'enterprise' },
          subscription: 'sub_upgraded789',
          customer: 'cus_new456',
        },
      },
    } as any)
    mockedSubscription.findFirst.mockResolvedValue({ id: 'existing-sub-1' } as any)
    mockedSubscription.update.mockResolvedValue({} as any)

    const response = await POST(reqWithSignature('good-sig'))

    expect(response.status).toBe(200)
    expect(mockedSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-sub-1' },
        data: expect.objectContaining({
          metadata: JSON.stringify({ stripeSubscriptionId: 'sub_upgraded789', stripeCustomerId: 'cus_new456' }),
        }),
      }),
    )
  })
})

describe('Stripe webhook — invoice.payment_succeeded records subscription revenue', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates a Payment row when a matching Subscription exists', async () => {
    mockedConstructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_123',
          subscription: 'sub_abc',
          amount_paid: 9900,
          currency: 'usd',
          payment_intent: 'pi_456',
        },
      },
    } as any)
    mockedSubscription.findFirst.mockResolvedValue({ id: 'db-sub-1', userId: 'user-1', plan: 'pro' } as any)
    mockedPayment.create.mockResolvedValue({} as any)

    const response = await POST(reqWithSignature('good-sig'))

    expect(response.status).toBe(200)
    expect(mockedPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          amount: 99,
          status: 'SUCCEEDED',
          stripePaymentId: 'pi_456',
          subscriptionId: 'db-sub-1',
        }),
      }),
    )
  })

  it('does not create a Payment for a non-subscription invoice', async () => {
    mockedConstructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_456', subscription: null, amount_paid: 500, currency: 'usd' } },
    } as any)

    const response = await POST(reqWithSignature('good-sig'))

    expect(response.status).toBe(200)
    expect(mockedSubscription.findFirst).not.toHaveBeenCalled()
    expect(mockedPayment.create).not.toHaveBeenCalled()
  })

  it('logs and skips (does not throw) when no Subscription matches the Stripe subscription id', async () => {
    mockedConstructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_789', subscription: 'sub_orphan', amount_paid: 2900, currency: 'usd' } },
    } as any)
    mockedSubscription.findFirst.mockResolvedValue(null)

    const response = await POST(reqWithSignature('good-sig'))

    expect(response.status).toBe(200)
    expect(mockedPayment.create).not.toHaveBeenCalled()
  })

  it('treats a duplicate delivery (unique-constraint violation) as success, not an error', async () => {
    mockedConstructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_dup', subscription: 'sub_abc', amount_paid: 9900, currency: 'usd', payment_intent: 'pi_dup' } },
    } as any)
    mockedSubscription.findFirst.mockResolvedValue({ id: 'db-sub-1', userId: 'user-1', plan: 'pro' } as any)
    const dupError: any = new Error('Unique constraint failed')
    dupError.code = 'P2002'
    mockedPayment.create.mockRejectedValue(dupError)

    const response = await POST(reqWithSignature('good-sig'))

    expect(response.status).toBe(200)
  })
})

describe('Stripe webhook — charge.refunded reconciles revenue', () => {
  beforeEach(() => jest.clearAllMocks())

  it('marks a fully-refunded payment REFUNDED so it drops out of revenue', async () => {
    mockedConstructEvent.mockReturnValue({
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_456', amount: 9900, amount_refunded: 9900 } },
    } as any)
    mockedPayment.findUnique.mockResolvedValue({ id: 'payment-1' } as any)

    const response = await POST(reqWithSignature('good-sig'))

    expect(response.status).toBe(200)
    expect(mockedPayment.update).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: { status: 'REFUNDED' },
    })
  })

  it('reduces the amount (does not mark REFUNDED) for a partial refund', async () => {
    mockedConstructEvent.mockReturnValue({
      type: 'charge.refunded',
      data: { object: { id: 'ch_2', payment_intent: 'pi_789', amount: 9900, amount_refunded: 2000 } },
    } as any)
    mockedPayment.findUnique.mockResolvedValue({ id: 'payment-2' } as any)

    const response = await POST(reqWithSignature('good-sig'))

    expect(response.status).toBe(200)
    expect(mockedPayment.update).toHaveBeenCalledWith({
      where: { id: 'payment-2' },
      data: { amount: 79 },
    })
  })

  it('skips cleanly when no Payment row matches the refunded charge', async () => {
    mockedConstructEvent.mockReturnValue({
      type: 'charge.refunded',
      data: { object: { id: 'ch_3', payment_intent: 'pi_unknown', amount: 1900, amount_refunded: 1900 } },
    } as any)
    mockedPayment.findUnique.mockResolvedValue(null)

    const response = await POST(reqWithSignature('good-sig'))

    expect(response.status).toBe(200)
    expect(mockedPayment.update).not.toHaveBeenCalled()
  })

  it('skips cleanly when the charge has no payment_intent at all', async () => {
    mockedConstructEvent.mockReturnValue({
      type: 'charge.refunded',
      data: { object: { id: 'ch_4', payment_intent: null, amount: 1900, amount_refunded: 1900 } },
    } as any)

    const response = await POST(reqWithSignature('good-sig'))

    expect(response.status).toBe(200)
    expect(mockedPayment.findUnique).not.toHaveBeenCalled()
    expect(mockedPayment.update).not.toHaveBeenCalled()
  })
})
