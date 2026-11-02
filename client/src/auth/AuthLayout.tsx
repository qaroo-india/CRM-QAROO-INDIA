/**
 * The signed-out frame: brand panel on wide screens, the form column beside
 * it. Shared by sign-in, forgot password, reset, activation and the public
 * certificate check, so they all look the same.
 */

import { BarChart3, GraduationCap, ShieldCheck, UsersRound, Wallet } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

// The 3D campus scene loads after the sign-in form, on wide screens only.
const CampusScene = lazy(() => import('@/components/visual/CampusScene'));

const HIGHLIGHTS = [
  { icon: GraduationCap, text: 'Enquiry to placement in one record' },
  { icon: Wallet, text: 'Exact fee ledgers, instalments and refunds' },
  { icon: BarChart3, text: 'Live dashboards and scheduled reports' },
  { icon: UsersRound, text: 'Own sign-in for office staff, faculty and students' },
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r bg-surface-sunken lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-backdrop-glow" />
        <Suspense fallback={null}>
          <CampusScene variant="hero" className="absolute inset-0" />
        </Suspense>
        {/* Keeps the headline readable over the scene. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-surface-sunken via-surface-sunken/85 to-transparent" />
        <div className="relative flex items-center gap-3">
          <BrandMark />
          <span className="text-lg font-semibold tracking-tight text-fg">Institute OS</span>
        </div>
        <div className="relative max-w-md space-y-6">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight text-fg">
            Admissions, classes, fees and placements in one place.
          </h2>
          <ul className="space-y-3">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-fg-muted">
                <span className="grid size-8 place-items-center rounded-lg border border-primary/25 bg-primary-soft text-primary">
                  <Icon aria-hidden className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-fg-subtle">
          <ShieldCheck aria-hidden className="size-4" />
          Sessions use HttpOnly cookies and are protected against cross-site requests.
        </p>
      </aside>

      <main className="flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between lg:justify-end">
          <div className="flex items-center gap-2 lg:hidden">
            <BrandMark />
            <span className="font-semibold text-fg">Institute OS</span>
          </div>
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="glass holo holo-live w-full max-w-md rounded-card border p-6 sm:p-8">
            <div className="stagger space-y-7">{children}</div>
          </div>
        </div>

        <footer className="text-center text-xs text-fg-subtle">
          <a href="/status" className="underline-offset-2 hover:text-fg hover:underline">
            System status
          </a>
        </footer>
      </main>
    </div>
  );
}

export function BrandMark({ className = 'size-9' }: { className?: string }) {
  return (
    <span className={`glow-breathe grid shrink-0 place-items-center rounded-xl border border-primary/30 bg-primary-soft ${className}`}>
      <svg viewBox="0 0 32 32" fill="none" aria-hidden className="size-[60%]">
        <path d="M8 22V10l8 5 8-5v12" className="stroke-primary" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="15" r="1.8" className="fill-violet" />
      </svg>
    </span>
  );
}
