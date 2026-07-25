"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

export function LeadCaptureForm({ creativeId }: { creativeId: string }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [message, setMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = Boolean(email.trim() || phone.trim())

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/l/${creativeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, message }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Could not submit — try again")
      }
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit — try again")
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border p-4 text-center text-sm">
        Thanks — they'll be in touch soon.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <Textarea placeholder="Anything else? (optional)" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
      <Button className="w-full" disabled={!canSubmit || submitting} onClick={submit}>
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Send
      </Button>
      <p className="text-center text-xs text-muted-foreground">Email or phone required so they can reach you.</p>
    </div>
  )
}
