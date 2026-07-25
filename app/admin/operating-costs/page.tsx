"use client"

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, DollarSign } from 'lucide-react'

const CATEGORIES = ['hosting', 'contractor', 'tooling', 'marketing_spend', 'other'] as const

interface Cost {
  id: string
  category: string
  description: string
  amountCents: number
  incurredOn: string
  notes: string | null
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export default function OperatingCostsPage() {
  const [costs, setCosts] = useState<Cost[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [category, setCategory] = useState<string>('hosting')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [incurredOn, setIncurredOn] = useState(todayIso())

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/operating-costs', { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to load costs')
      const data = await res.json()
      setCosts(data.costs || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load costs')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreate = async () => {
    const dollars = Number(amount)
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError('Enter a valid amount')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/operating-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          description,
          amountCents: Math.round(dollars * 100),
          incurredOn: new Date(incurredOn).toISOString(),
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to create cost')
      setDescription('')
      setAmount('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create cost')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setError(null)
    try {
      const res = await fetch('/api/admin/operating-costs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to delete cost')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete cost')
    }
  }

  const totalUsd = costs.reduce((sum, c) => sum + c.amountCents, 0) / 100
  const byCategory = CATEGORIES.map((cat) => ({
    category: cat,
    totalUsd: costs.filter((c) => c.category === cat).reduce((sum, c) => sum + c.amountCents, 0) / 100,
  })).filter((c) => c.totalUsd > 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Operating Costs</h1>
        <p className="text-muted-foreground">
          Hosting, contractors, tooling, marketing spend — entered by hand, nothing inferred or
          auto-charged. Separate from AI generation cost (that's tracked automatically via AIGeneration
          and already shown on the evidence dashboard).
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Total recorded</CardDescription></CardHeader>
          <CardContent className="text-2xl font-bold">${totalUsd.toFixed(2)}</CardContent>
        </Card>
        {byCategory.map((c) => (
          <Card key={c.category}>
            <CardHeader className="pb-2"><CardDescription>{c.category.replace('_', ' ')}</CardDescription></CardHeader>
            <CardContent className="text-2xl font-bold">${c.totalUsd.toFixed(2)}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DollarSign className="h-4 w-4" /> Add Cost</CardTitle>
          <CardDescription>Log an expense as soon as it happens — don't batch it before submission.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="cost-category">Category</Label>
              <select id="cost-category" className="w-full rounded-md border px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="cost-description">Description</Label>
              <Input id="cost-description" placeholder="ElevenLabs Creator plan — July" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-amount">Amount (USD)</Label>
              <Input id="cost-amount" type="number" step="0.01" min="0" placeholder="22.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2 md:w-48">
            <Label htmlFor="cost-date">Date incurred</Label>
            <Input id="cost-date" type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} />
          </div>
          <Button onClick={handleCreate} disabled={isSaving || !description.trim() || !amount}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Cost
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Costs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : costs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No costs recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costs.map((cost) => (
                  <TableRow key={cost.id}>
                    <TableCell>{cost.incurredOn.slice(0, 10)}</TableCell>
                    <TableCell><Badge variant="outline">{cost.category.replace('_', ' ')}</Badge></TableCell>
                    <TableCell>{cost.description}</TableCell>
                    <TableCell className="text-right">${(cost.amountCents / 100).toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(cost.id)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
