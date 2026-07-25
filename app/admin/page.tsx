import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Video, DollarSign, ShieldAlert, Cpu, ArrowUpRight } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { PRICING_PLANS } from '@/lib/stripe';

/**
 * Admin overview — REAL numbers only, queried server-side.
 *
 * Replaces a 750-line client page of fabricated charts and invented users
 * ("john@example.com", $89,432 revenue) that rendered for anyone. Every figure
 * here comes from the database; when the platform is empty this page honestly
 * shows zeros. Access is gated by app/admin/layout.tsx.
 */

export const dynamic = 'force-dynamic';

const PRICE_BY_PLAN: Record<string, number> = Object.fromEntries(
  Object.values(PRICING_PLANS).map((p) => [p.id, p.price]),
);

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export default async function AdminOverviewPage() {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    userCount,
    newUsers7d,
    videoTotals,
    activePlans,
    openReports,
    aiCostMonth,
    aiCostAll,
    recentUsers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.video.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.subscription.groupBy({
      by: ['plan'],
      where: { status: 'ACTIVE' },
      _count: { plan: true },
    }),
    prisma.contentReport.count({ where: { status: 'open' } }),
    prisma.aIGeneration.aggregate({
      _sum: { cost: true },
      _count: { id: true },
      where: { createdAt: { gte: monthStart } },
    }),
    prisma.aIGeneration.aggregate({ _sum: { cost: true }, _count: { id: true } }),
    prisma.user.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
  ]);

  const videosByStatus = Object.fromEntries(videoTotals.map((v) => [v.status, v._count.status]));
  const videoCount = videoTotals.reduce((sum, v) => sum + v._count.status, 0);
  const mrr = activePlans.reduce((sum, p) => sum + (PRICE_BY_PLAN[p.plan] ?? 0) * p._count.plan, 0);
  const paidSubs = activePlans
    .filter((p) => (PRICE_BY_PLAN[p.plan] ?? 0) > 0)
    .reduce((sum, p) => sum + p._count.plan, 0);

  const stats = [
    {
      label: 'Users',
      icon: Users,
      value: userCount.toLocaleString(),
      detail: `${newUsers7d} new in the last 7 days`,
    },
    {
      label: 'Videos',
      icon: Video,
      value: videoCount.toLocaleString(),
      detail: `${videosByStatus.COMPLETED ?? 0} completed · ${videosByStatus.FAILED ?? 0} failed`,
    },
    {
      label: 'MRR',
      icon: DollarSign,
      value: fmtMoney(mrr),
      detail: `${paidSubs} active paid subscription${paidSubs === 1 ? '' : 's'}`,
    },
    {
      label: 'AI cost (month)',
      icon: Cpu,
      value: fmtMoney(Number(aiCostMonth._sum.cost ?? 0)),
      detail: `${aiCostMonth._count.id} generations · ${fmtMoney(Number(aiCostAll._sum.cost ?? 0))} all-time`,
    },
  ];

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold">Admin</h1>
            <p className="text-sm text-muted-foreground">Live platform numbers — straight from the database.</p>
          </div>
          {openReports > 0 && (
            <Badge variant="destructive" className="gap-1">
              <ShieldAlert className="h-3.5 w-3.5" />
              {openReports} open content report{openReports === 1 ? '' : 's'}
            </Badge>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{s.label}</CardTitle>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{s.value}</div>
                <p className="text-xs text-muted-foreground">{s.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent signups</CardTitle>
              <CardDescription>The latest five accounts.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No users yet.</p>
              ) : (
                <ul className="space-y-3">
                  {recentUsers.map((u) => (
                    <li key={u.id} className="flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium">{u.name ?? 'Unnamed'}</span>{' '}
                        <span className="text-muted-foreground">{u.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{u.role}</Badge>
                        {u.createdAt.toISOString().slice(0, 10)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tools</CardTitle>
              <CardDescription>Working admin surfaces.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { href: '/admin/beta', label: 'Beta access — invites & allow-list' },
                { href: '/admin/security/sso', label: 'SSO — per-organization sign-on' },
                { href: '/api/admin/revenue', label: 'Revenue API — full JSON breakdown' },
                { href: '/api/admin/product-insights', label: 'Product insights API' },
                { href: '/admin/evidence', label: 'Hackathon evidence — users, activation, costs & revenue' },
                { href: '/admin/leads', label: 'Outbound leads — dealer/realtor/e-commerce pipeline' },
              ].map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted"
                >
                  {t.label}
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
