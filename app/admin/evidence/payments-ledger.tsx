"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { withCsrfHeaders } from "@/lib/csrf-client"

interface PaymentRow {
  id: string
  /** Dollars (the Stripe webhook divides cents by 100 at write time); Prisma Decimal serializes as a string. */
  amount: number | string
  currency: string
  status: string
  isRelatedParty: boolean
  stripePaymentId: string | null
  createdAt: string
  user: { email: string | null } | null
  subscription: { plan: string } | null
}

/**
 * The Stripe payment ledger with the per-row related-party toggle — the
 * edit surface for the classification the evidence methodology promises
 * ("flagged per-row, not inferred"). Leads have had this since the
 * attribution work; payments could previously only be reclassified by
 * editing the database directly. Every flip is appended to the evidence
 * ledger server-side.
 */
export function PaymentsLedger() {
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/payments")
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Could not load payments")
      setPayments(data.payments ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load payments")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async (payment: PaymentRow) => {
    setSavingId(payment.id)
    try {
      const res = await fetch("/api/admin/payments", {
        method: "PATCH",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id: payment.id, isRelatedParty: !payment.isRelatedParty }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Update failed")
      setPayments((rows) =>
        rows.map((row) => (row.id === payment.id ? { ...row, isRelatedParty: data.payment.isRelatedParty } : row)),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed")
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stripe payment ledger</CardTitle>
        <CardDescription>
          Related-party flips are appended to the evidence chain; flagged rows
          are excluded from judged revenue. Refresh the page to see totals
          above update.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading payments…
          </div>
        ) : payments.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-normal">Date</th>
                  <th className="py-2 pr-3 font-normal">Customer</th>
                  <th className="py-2 pr-3 font-normal">Amount</th>
                  <th className="py-2 pr-3 font-normal">Status</th>
                  <th className="py-2 pr-3 font-normal">Plan</th>
                  <th className="py-2 font-normal">Related party</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(payment.createdAt).toLocaleDateString()}</td>
                    <td className="py-2 pr-3">{payment.user?.email ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      ${Number(payment.amount).toFixed(2)} {payment.currency?.toUpperCase()}
                    </td>
                    <td className="py-2 pr-3">{payment.status}</td>
                    <td className="py-2 pr-3">{payment.subscription?.plan ?? "one-time"}</td>
                    <td className="py-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={payment.isRelatedParty}
                          disabled={savingId === payment.id}
                          onChange={() => toggle(payment)}
                        />
                        {payment.isRelatedParty && <span className="text-xs text-amber-500">excluded</span>}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default PaymentsLedger
