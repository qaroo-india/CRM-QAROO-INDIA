/**
 * System Status -- the Milestone 1 landing page.
 *
 * Proves the full stack end to end: browser -> Vite proxy -> Express -> SQLite
 * and back, with the response validated against the shared contract. It also
 * establishes the visual language (surfaces, tokens, status semantics) that
 * the Milestone 2 application shell builds on.
 */

import type { DependencyHealth, HealthResponse, HealthState } from '@ims/shared';
import {
  Activity,
  CircleCheck,
  CircleX,
  Clock,
  Database,
  GitBranch,
  Globe,
  RefreshCw,
  ServerCrash,
  Settings2,
  Timer,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusDot, type StatusDotTone } from '@/components/ui/StatusDot';
import { useNow } from '@/hooks/useNow';
import { API_BASE_URL, type ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDuration, formatElapsed, formatInZoneLong, formatLatency } from '@/utils/format';
import { HEALTH_REFRESH_MS, useHealth } from './useHealth';

const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'Institute OS';

/* ------------------------------------------------------------------ *
 * Status vocabulary
 * ------------------------------------------------------------------ */

interface StatePresentation {
  title: string;
  description: string;
  tone: StatusDotTone & BadgeTone;
  icon: LucideIcon;
}

const OVERALL: Record<HealthState, StatePresentation> = {
  ok: {
    title: 'All systems operational',
    description: 'The API, database and schema are healthy and ready for work.',
    tone: 'success',
    icon: CircleCheck,
  },
  degraded: {
    title: 'Setup incomplete',
    description: 'The API is running, but a setup step is still pending. The checks below say exactly what to run.',
    tone: 'warning',
    icon: TriangleAlert,
  },
  down: {
    title: 'Service unavailable',
    description: 'The API is running but cannot reach its database.',
    tone: 'danger',
    icon: CircleX,
  },
};

const DEPENDENCY_STATUS_LABEL: Record<HealthState, string> = {
  ok: 'Operational',
  degraded: 'Action needed',
  down: 'Down',
};

const DEPENDENCIES: Record<string, { label: string; icon: LucideIcon }> = {
  database: { label: 'Database', icon: Database },
  migrations: { label: 'Schema migrations', icon: GitBranch },
  settings: { label: 'Institute settings', icon: Settings2 },
  accounts: { label: 'Owner account', icon: UserRound },
};

const toneFor = (state: HealthState) => OVERALL[state].tone;

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export function SystemStatusPage() {
  const health = useHealth();

  return (
    <div className="relative isolate min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-grid" />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-backdrop-glow" />

      <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 sm:px-6 lg:py-12">
        <PageHeader onRefresh={() => void health.refetch()} refreshing={health.isFetching} />

        <main className="mt-8 flex-1 space-y-5 lg:mt-12" aria-labelledby="status-heading">
          <h1 id="status-heading" className="sr-only">
            System status
          </h1>

          {health.isPending ? (
            <LoadingState />
          ) : health.isError ? (
            <ErrorState error={health.error} onRetry={() => void health.refetch()} retrying={health.isFetching} />
          ) : (
            <HealthReport data={health.data} updatedAt={health.dataUpdatedAt} />
          )}
        </main>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs text-fg-subtle">
          <span>
            Public diagnostics page. <a href="/" className="underline-offset-2 hover:text-fg hover:underline">Back to the app</a>
          </span>
          <span className="font-mono">{API_BASE_URL}</span>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Header
 * ------------------------------------------------------------------ */

function PageHeader({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <BrandMark />
        <div>
          <p className="text-base font-semibold tracking-tight text-fg">{APP_NAME}</p>
          <p className="text-xs text-fg-muted">Operations &amp; Intelligence Platform</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge tone="violet" className="hidden sm:inline-flex">
          Public diagnostics
        </Badge>
        <ThemeToggle />
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing} aria-label="Refresh status">
          <RefreshCw aria-hidden className={cn('size-3.5', refreshing && 'animate-spin')} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>
    </header>
  );
}

function BrandMark() {
  return (
    <span className="grid size-10 place-items-center rounded-xl border border-primary/30 bg-primary-soft shadow-glow">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden className="size-6">
        <path
          d="M8 22V10l8 5 8-5v12"
          className="stroke-primary"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="15" r="1.8" className="fill-violet" />
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Success: the health report
 * ------------------------------------------------------------------ */

function HealthReport({ data, updatedAt }: { data: HealthResponse; updatedAt: number }) {
  const now = useNow();
  const overall = OVERALL[data.status];
  const OverallIcon = overall.icon;

  return (
    <>
      <Card className="animate-fade-up overflow-hidden">
        <div className="flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4" role="status" aria-live="polite">
            <span
              className={cn(
                'grid size-12 shrink-0 place-items-center rounded-2xl border',
                overall.tone === 'success' && 'border-success/30 bg-success-soft text-success',
                overall.tone === 'warning' && 'border-warning/30 bg-warning-soft text-warning',
                overall.tone === 'danger' && 'border-danger/30 bg-danger-soft text-danger',
              )}
            >
              <OverallIcon aria-hidden className="size-6" />
            </span>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <StatusDot tone={overall.tone} pulse={data.status === 'ok'} />
                <p className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{overall.title}</p>
              </div>
              <p className="max-w-xl text-sm text-fg-muted">{overall.description}</p>
              <p className="text-xs text-fg-subtle">
                Checked {formatElapsed(now - updatedAt)} · refreshes every {HEALTH_REFRESH_MS / 1000}s
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-3 sm:gap-6 lg:min-w-80">
            <MetaStat label="Environment">
              <Badge tone={data.environment === 'production' ? 'success' : 'primary'}>{data.environment}</Badge>
            </MetaStat>
            <MetaStat label="Version">
              <span className="font-mono text-sm text-fg">v{data.version}</span>
            </MetaStat>
            <MetaStat label="Uptime">
              <span className="font-mono text-sm tabular-nums text-fg">{formatDuration(data.uptimeSeconds)}</span>
            </MetaStat>
          </dl>
        </div>
      </Card>

      <section aria-label="Dependency checks" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.dependencies.map((dependency, index) => (
          <DependencyCard key={dependency.name} dependency={dependency} index={index} />
        ))}
      </section>

      <Card className="animate-fade-up [animation-delay:240ms]">
        <CardContent className="grid gap-5 sm:grid-cols-3">
          <InfoItem icon={Clock} label="Server time (institute zone)">
            <span className="font-mono tabular-nums">{formatInZoneLong(data.timestamp, data.timezone)}</span>
          </InfoItem>
          <InfoItem icon={Globe} label="Institute time zone">
            <span className="font-mono">{data.timezone}</span>
          </InfoItem>
          <InfoItem icon={Activity} label="Service">
            <span className="font-mono">{data.service}</span>
          </InfoItem>
        </CardContent>
      </Card>
    </>
  );
}

function MetaStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <dt className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function DependencyCard({ dependency, index }: { dependency: DependencyHealth; index: number }) {
  const meta = DEPENDENCIES[dependency.name] ?? { label: dependency.name, icon: Activity };
  const Icon = meta.icon;
  const tone = toneFor(dependency.status);

  return (
    <Card
      className={cn(
        'animate-fade-up transition-[border-color,box-shadow] duration-200 hover:border-border-strong',
        dependency.status !== 'ok' && 'border-warning/40',
        dependency.status === 'down' && 'border-danger/40',
      )}
      style={{ animationDelay: `${80 + index * 60}ms` }}
    >
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-9 place-items-center rounded-lg border bg-surface-raised text-fg-muted">
            <Icon aria-hidden className="size-4.5" />
          </span>
          <Badge tone={tone} dot>
            {DEPENDENCY_STATUS_LABEL[dependency.status]}
          </Badge>
        </div>

        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-fg">{meta.label}</h2>
          {dependency.detail && <p className="text-sm text-fg-muted">{dependency.detail}</p>}
        </div>

        <div className="mt-auto flex items-center gap-1.5 border-t pt-3 text-xs text-fg-subtle">
          <Timer aria-hidden className="size-3.5" />
          <span>Probe</span>
          <span className="ml-auto font-mono tabular-nums text-fg-muted">{formatLatency(dependency.latencyMs)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoItem({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs text-fg-subtle">{label}</p>
        <p className="truncate text-sm text-fg">{children}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Loading and error states
 * ------------------------------------------------------------------ */

function LoadingState() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-5">
      <span className="sr-only">Checking system status…</span>
      <Card className="p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <Skeleton className="size-12 rounded-2xl" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-64 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="space-y-4 p-5">
            <div className="flex justify-between">
              <Skeleton className="size-9 rounded-lg" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry, retrying }: { error: ApiRequestError; onRetry: () => void; retrying: boolean }) {
  const unreachable = error.isUnreachable;

  return (
    <Card className="animate-fade-up border-danger/40" role="alert">
      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-danger/30 bg-danger-soft text-danger">
            <ServerCrash aria-hidden className="size-6" />
          </span>
          <div className="space-y-1.5">
            <p className="text-xl font-semibold tracking-tight text-fg">
              {unreachable ? 'API unreachable' : 'Health check failed'}
            </p>
            <p className="max-w-xl text-sm text-fg-muted">{error.message}</p>
            {error.requestId && (
              <p className="text-xs text-fg-subtle">
                Request ID <span className="font-mono">{error.requestId}</span>
              </p>
            )}
          </div>
        </div>

        {unreachable && (
          <div className="rounded-control border bg-surface-sunken p-4">
            <p className="mb-2 text-sm font-medium text-fg">Things to check</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-fg-muted">
              <li>
                Is the API running? Start it with <code className="font-mono text-fg">npm run dev:server</code>, or
                both apps with <code className="font-mono text-fg">npm run dev</code>.
              </li>
              <li>Did it stop on a configuration error? Its terminal names the variable to fix.</li>
              <li>
                Is port 5000 in use by something else? Change <code className="font-mono text-fg">PORT</code> in{' '}
                <code className="font-mono text-fg">server/.env</code> and{' '}
                <code className="font-mono text-fg">VITE_API_PROXY_TARGET</code> in{' '}
                <code className="font-mono text-fg">client/.env</code> together.
              </li>
            </ul>
          </div>
        )}

        <div>
          <Button onClick={onRetry} loading={retrying}>
            {!retrying && <RefreshCw aria-hidden className="size-4" />}
            Try again
          </Button>
        </div>
      </div>
    </Card>
  );
}
