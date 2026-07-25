"use client"

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, UserPlus } from 'lucide-react'

const STATUSES = ['NEW', 'SAMPLE_SENT', 'REPLIED', 'MEETING', 'PILOT', 'PAID', 'RETAINED', 'DEAD'] as const
type LeadStatus = (typeof STATUSES)[number]
const VERTICALS = ['auto', 'realestate', 'ecom', 'self_serve'] as const

interface Lead {
  id: string
  vertical: string
  businessName: string
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  source: string
  status: LeadStatus
  isRelatedParty: boolean
  revenueCents: number | null
  testimonialConsent: boolean
  notes: string | null
  sampleSentAt: string | null
  convertedAt: string | null
  createdAt: string
}

export default function LeadsAdminPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [vertical, setVertical] = useState<string>('auto')
  const [businessName, setBusinessName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [source, setSource] = useState('outbound_dm')
  const [isRelatedParty, setIsRelatedParty] = useState(false)

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/leads', { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to load leads')
      const data = await res.json()
      setLeads(data.leads || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leads')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreate = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vertical, businessName, contactName, contactEmail, contactPhone, source, isRelatedParty }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to create lead')
      setBusinessName('')
      setContactName('')
      setContactEmail('')
      setContactPhone('')
      setIsRelatedParty(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create lead')
    } finally {
      setIsSaving(false)
    }
  }

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null)
    try {
      const res = await fetch('/api/admin/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to update lead')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update lead')
    }
  }

  const handleStatusChange = (lead: Lead, status: LeadStatus) => {
    const extra: Record<string, unknown> = { status }
    if (status === 'SAMPLE_SENT' && !lead.sampleSentAt) extra.sampleSentAt = new Date().toISOString()
    if ((status === 'PAID' || status === 'RETAINED') && !lead.convertedAt) extra.convertedAt = new Date().toISOString()
    patch(lead.id, extra)
  }

  const handleRevenue = (lead: Lead, dollars: string) => {
    const parsed = dollars.trim() === '' ? null : Math.round(Number(dollars) * 100)
    if (parsed !== null && Number.isNaN(parsed)) return
    patch(lead.id, { revenueCents: parsed })
  }

  const handleDelete = async (id: string) => {
    setError(null)
    try {
      const res = await fetch('/api/admin/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to delete lead')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete lead')
    }
  }

  const armsLength = leads.filter((l) => !l.isRelatedParty)
  const converted = armsLength.filter((l) => l.convertedAt)
  const revenueUsd = armsLength.reduce((sum, l) => sum + (l.revenueCents ?? 0), 0) / 100

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Outbound Leads</h1>
        <p className="text-muted-foreground">
          Every real prospect from the dealer/realtor/e-commerce outreach — the database version of the
          outbound trackers, feeding the hackathon evidence dashboard directly.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Total leads</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{leads.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Converted (arms-length)</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{converted.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Revenue (arms-length)</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">${revenueUsd.toFixed(2)}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> Add Lead</CardTitle>
          <CardDescription>Log a real prospect once you send them a sample or they reply — matches the dealers.csv / realtors.csv / ecommerce.csv pipeline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="lead-vertical">Vertical</Label>
              <select id="lead-vertical" className="w-full rounded-md border px-3 py-2 text-sm" value={vertical} onChange={(e) => setVertical(e.target.value)}>
                {VERTICALS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-business">Business name</Label>
              <Input id="lead-business" placeholder="Machado Auto Sales" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-source">Source</Label>
              <Input id="lead-source" placeholder="outbound_dm" value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="lead-contact-name">Contact name</Label>
              <Input id="lead-contact-name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-contact-email">Contact email</Label>
              <Input id="lead-contact-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-contact-phone">Contact phone</Label>
              <Input id="lead-contact-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isRelatedParty} onChange={(e) => setIsRelatedParty(e.target.checked)} />
            Related party (friend/family/team) — excluded from judged revenue
          </label>
          <Button onClick={handleCreate} disabled={isSaving || !businessName.trim()}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Lead
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Leads</CardTitle>
          <CardDescription>Update status as the conversation moves — it drives the hackathon evidence totals directly.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading leads...
            </div>
          ) : leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leads yet. Add one above, or send a sample with `prospect-sample.ts --email` and log it here once they reply.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Vertical</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Related party</TableHead>
                  <TableHead>Testimonial</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <div className="font-medium">{lead.businessName}</div>
                      <div className="text-xs text-muted-foreground">{lead.contactName || lead.contactEmail || lead.contactPhone || '—'}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{lead.vertical}</Badge></TableCell>
                    <TableCell>
                      <select
                        className="rounded-md border px-2 py-1 text-xs"
                        value={lead.status}
                        onChange={(e) => handleStatusChange(lead, e.target.value as LeadStatus)}
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="w-24"
                        placeholder="$"
                        defaultValue={lead.revenueCents != null ? (lead.revenueCents / 100).toFixed(2) : ''}
                        onBlur={(e) => handleRevenue(lead, e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={lead.isRelatedParty}
                        onChange={(e) => patch(lead.id, { isRelatedParty: e.target.checked })}
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={lead.testimonialConsent}
                        onChange={(e) => patch(lead.id, { testimonialConsent: e.target.checked })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(lead.id)}>Delete</Button>
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
