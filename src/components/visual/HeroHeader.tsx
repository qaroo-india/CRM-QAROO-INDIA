/**
 * Page header with a live 3D "campus network" on the right, for the home pages
 * (executive dashboard, faculty home, student overview). The scene loads after
 * the page, only on wide screens; until then the grid and glow already make a
 * finished header.
 */

import { lazy, Suspense, type ReactNode } from 'react';

const CampusScene = lazy(() => import('./CampusScene'));

interface HeroHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function HeroHeader({ eyebrow, title, description, actions }: HeroHeaderProps) {
  return (
    <header className="relative mb-6 overflow-hidden rounded-card border bg-surface shadow-card">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-70" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-backdrop-glow" />
      <div className="relative grid items-center gap-4 md:grid-cols-[minmax(0,1fr)_minmax(240px,36%)]">
        <div className="stagger min-w-0 space-y-2 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            {eyebrow && <p className="text-xs font-medium tracking-wider text-primary uppercase">{eyebrow}</p>}
            <div className="rounded-lg bg-white/95 px-2.5 py-1 shadow-sm border border-white/20 shrink-0">
              <img src="/logo.png" alt="Qaroo India Private Limited" className="h-5.5 w-auto object-contain" />
            </div>
          </div>
          <h1 className="text-gradient text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {description && <p className="max-w-2xl text-sm text-fg-muted">{description}</p>}
          {actions && <div className="flex flex-wrap items-center gap-2 pt-2">{actions}</div>}
        </div>
        <div className="relative hidden h-44 self-stretch md:block">
          <Suspense fallback={null}>
            <CampusScene variant="banner" className="absolute inset-0" />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
