import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  VIDEO_GENERATION: 'Video generation',
  STORYBOARD: 'Storyboard',
  SCRIPT_WRITING: 'Script writing',
  VOICE_SYNTHESIS: 'Voice synthesis',
  IMAGE_GENERATION: 'Image generation',
  GROWTH_DECISION: 'Growth decision',
}

function truncate(text: string | null, max: number): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export default async function AiDecisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const type = (await searchParams)?.type
  const generations = await prisma.aIGeneration.findMany({
    where: type ? { type: type as any } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, type: true, status: true, prompt: true, result: true,
      tokensUsed: true, cost: true, createdAt: true,
      user: { select: { email: true } },
    },
  })

  const totalCost = generations.reduce((sum, g) => sum + Number(g.cost || 0), 0)
  const types = Object.keys(TYPE_LABEL)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Gemini decisions</h1>
        <p className="text-muted-foreground">
          The last 100 AI generations — every prompt Gemini received and the raw result it returned, with
          cost and token usage. This is the explainability trail: what the model was asked, what it decided,
          what it cost. Not a curated summary — the actual records.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Shown / total cost</CardDescription></CardHeader>
          <CardContent className="text-2xl font-bold">{generations.length} / ${totalCost.toFixed(4)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Failed generations (shown)</CardDescription></CardHeader>
          <CardContent className="text-2xl font-bold">{generations.filter((g) => g.status === 'FAILED').length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Filter</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-xs">
            <a href="/admin/ai-decisions" className={`rounded px-2 py-1 ${!type ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>All</a>
            {types.map((t) => (
              <a key={t} href={`/admin/ai-decisions?type=${t}`} className={`rounded px-2 py-1 ${type === t ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                {TYPE_LABEL[t]}
              </a>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        {generations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No generations recorded yet for this filter.</p>
        ) : (
          generations.map((g) => (
            <Card key={g.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{TYPE_LABEL[g.type] || g.type}</Badge>
                    <Badge variant={g.status === 'FAILED' ? 'destructive' : g.status === 'COMPLETED' ? 'default' : 'secondary'}>
                      {g.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{g.user?.email || 'unknown user'}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {g.createdAt.toISOString()} · {g.tokensUsed ?? '?'} tokens · ${Number(g.cost || 0).toFixed(4)}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <details>
                  <summary className="cursor-pointer font-medium">Prompt</summary>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{truncate(g.prompt, 4000)}</pre>
                </details>
                <details>
                  <summary className="cursor-pointer font-medium">Result</summary>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{truncate(g.result, 4000)}</pre>
                </details>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
