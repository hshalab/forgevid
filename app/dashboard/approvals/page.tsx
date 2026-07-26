"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, QrCode, RefreshCcw, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useGrowthLocale } from "@/hooks/use-growth-locale";

interface ApprovalRow {
  id: string;
  label: string;
  hook?: string | null;
  cta?: string | null;
  aspect?: string | null;
  approvalStatus: string;
  rightsStatus: string;
  revision: number;
  reviewNote?: string | null;
  recommendationReason?: string | null;
  expectedResult?: string | null;
  estimatedCostCents?: number | null;
  campaign?: { name: string; brief: string; platform: string } | null;
  video?: { status: string; url?: string | null; thumbnail?: string | null } | null;
  publicUrl?: string | null;
  history?: Array<{
    id: string;
    revision: number;
    action: string;
    rightsConfirmed: boolean;
    note?: string | null;
    snapshotHash: string;
    createdAt: string;
  }>;
}

const FILTERS = ["AWAITING_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "ALL"];

export default function ApprovalsPage() {
  const { t } = useGrowthLocale();
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("AWAITING_REVIEW");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rights, setRights] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [revisions, setRevisions] = useState<Record<string, { hook: string; cta: string }>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/approvals", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load approvals.");
      setRows(Array.isArray(data.approvals) ? data.approvals : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load approvals.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(
    () => rows.filter((row) => filter === "ALL" || row.approvalStatus === filter),
    [rows, filter],
  );

  const act = async (row: ApprovalRow, action: string) => {
    setSaving(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          note: notes[row.id] || "",
          rightsConfirmed: rights[row.id] === true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update this campaign.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this campaign.");
    } finally {
      setSaving(null);
    }
  };

  const bulkApprove = async () => {
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (!ids.length || !window.confirm(`Approve ${ids.length} completed revisions and confirm you own or are authorized to use all selected content?`)) return;
    setSaving("bulk");
    const response = await fetch("/api/approvals/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "approve", rightsConfirmed: true, note: "Bulk reviewed and approved by account owner." }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || "Bulk approval failed.");
    else { setSelected({}); await load(); }
    setSaving(null);
  };

  const regenerate = async (row: ApprovalRow) => {
    const revision = revisions[row.id];
    if (!revision?.hook && !revision?.cta) return;
    setSaving(row.id);
    const response = await fetch(`/api/approvals/${row.id}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hookNarration: revision.hook || undefined,
        ctaNarration: revision.cta || undefined,
        note: notes[row.id] || "Selective hook/CTA revision requested by owner.",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || "Selective regeneration failed.");
    else await load();
    setSaving(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <ShieldCheck className="h-7 w-7 text-primary" /> {t("approvalsTitle")}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t("noAutopublish")}
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCcw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? "default" : "outline"}
            onClick={() => setFilter(value)}
          >
            {value.replaceAll("_", " ").toLowerCase()}
          </Button>
        ))}
      </div>
      {Object.values(selected).some(Boolean) && (
        <Button onClick={() => void bulkApprove()} disabled={saving === "bulk"}>
          <CheckCircle2 className="h-4 w-4" /> Approve selected completed revisions
        </Button>
      )}

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-red-300">{error}</div>}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading approvals…
        </div>
      ) : visible.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No campaigns match this filter.</CardContent></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {visible.map((row) => {
            const working = saving === row.id;
            return (
              <Card key={row.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Checkbox checked={selected[row.id] || false} onCheckedChange={(checked) => setSelected((current) => ({ ...current, [row.id]: checked === true }))} />
                        {row.campaign?.name || row.label}
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Revision {row.revision} · {row.aspect || "default"} · {row.campaign?.platform || "campaign"}
                      </p>
                    </div>
                    <Badge variant={row.approvalStatus === "APPROVED" ? "default" : "outline"}>
                      {row.approvalStatus.replaceAll("_", " ")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {row.video?.url ? (
                    <video
                      controls
                      playsInline
                      src={row.video.url}
                      poster={row.video.thumbnail || undefined}
                      className="max-h-80 w-full rounded-lg bg-black"
                    />
                  ) : (
                    <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                      Video status: {row.video?.status || "not linked"}
                    </div>
                  )}

                  <div className="space-y-2 text-sm">
                    <p><strong>AI recommendation:</strong> {row.recommendationReason || "Generated from the campaign brief."}</p>
                    {row.hook && <p><strong>Hook:</strong> {row.hook}</p>}
                    {row.cta && <p><strong>CTA:</strong> {row.cta}</p>}
                    {row.expectedResult && <p><strong>Expected result:</strong> {row.expectedResult}</p>}
                    <p>
                      <strong>Estimated generation cost:</strong>{" "}
                      {row.estimatedCostCents == null ? "Not available" : `$${(row.estimatedCostCents / 100).toFixed(2)}`}
                    </p>
                    <p><strong>Rights status:</strong> {row.rightsStatus.toLowerCase()}</p>
                  </div>

                  {row.reviewNote && (
                    <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
                      Previous review note: {row.reviewNote}
                    </div>
                  )}

                  {row.history && row.history.length > 0 && (
                    <details className="rounded-md border p-3 text-sm">
                      <summary className="cursor-pointer font-medium">{t("immutableHistory")} ({row.history.length})</summary>
                      <div className="mt-3 space-y-3">
                        {row.history.map((event) => (
                          <div key={event.id} className="border-l-2 pl-3">
                            <p className="font-medium">Revision {event.revision} · {event.action.replaceAll("_", " ")}</p>
                            <p className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()} · rights {event.rightsConfirmed ? "confirmed" : "not confirmed"}</p>
                            {event.note && <p>{event.note}</p>}
                            <p className="break-all font-mono text-[10px] text-muted-foreground">Snapshot SHA-256: {event.snapshotHash}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  <Textarea
                    value={notes[row.id] || ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                    placeholder="Review note or requested revision…"
                    rows={3}
                  />

                  <details className="rounded-md border p-3 text-sm">
                    <summary className="cursor-pointer font-medium">Regenerate only the hook or CTA</summary>
                    <div className="mt-3 space-y-3">
                      <Input placeholder="Replacement opening narration" value={revisions[row.id]?.hook || ""} onChange={(event) => setRevisions((current) => ({ ...current, [row.id]: { hook: event.target.value, cta: current[row.id]?.cta || "" } }))} />
                      <Input placeholder="Replacement closing narration" value={revisions[row.id]?.cta || ""} onChange={(event) => setRevisions((current) => ({ ...current, [row.id]: { hook: current[row.id]?.hook || "", cta: event.target.value } }))} />
                      <Button variant="outline" disabled={working || (!revisions[row.id]?.hook && !revisions[row.id]?.cta)} onClick={() => void regenerate(row)}>
                        <RefreshCcw className="h-4 w-4" /> Create new selective revision
                      </Button>
                    </div>
                  </details>

                  {row.approvalStatus !== "APPROVED" && (
                    <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                      <Checkbox
                        checked={rights[row.id] || row.rightsStatus === "CONFIRMED"}
                        onCheckedChange={(checked) =>
                          setRights((current) => ({ ...current, [row.id]: checked === true }))
                        }
                      />
                      <span>I own or am authorized to use all campaign content.</span>
                    </label>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {row.approvalStatus === "CHANGES_REQUESTED" || row.approvalStatus === "REJECTED" ? (
                      <Button disabled={working} onClick={() => void act(row, "resubmit")}>
                        <RefreshCcw className="h-4 w-4" /> Resubmit new revision
                      </Button>
                    ) : row.approvalStatus !== "APPROVED" ? (
                      <>
                        <Button
                          disabled={working || row.video?.status !== "COMPLETED"}
                          onClick={() => void act(row, "approve")}
                        >
                          <CheckCircle2 className="h-4 w-4" /> Approve revision
                        </Button>
                        <Button variant="outline" disabled={working} onClick={() => void act(row, "request_revision")}>
                          Request changes
                        </Button>
                        <Button variant="destructive" disabled={working} onClick={() => void act(row, "reject")}>
                          <XCircle className="h-4 w-4" /> Reject
                        </Button>
                      </>
                    ) : row.publicUrl ? (
                      <>
                        <Button asChild variant="outline">
                          <a href={row.publicUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" /> Open approved landing page
                          </a>
                        </Button>
                        <Button asChild variant="outline">
                          <a href={`/api/ad-studio/creatives/${row.id}/qr`} download>
                            <QrCode className="h-4 w-4" /> Download QR
                          </a>
                        </Button>
                      </>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
