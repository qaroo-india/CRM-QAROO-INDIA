import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { NavLink } from 'react-router';
import { BrandMark } from '@/auth/LoginPage';
import { useAuth } from '@/auth/AuthProvider';
import { Tooltip } from '@/components/ui/Menu';
import { cn } from '@/lib/cn';
import { visibleSections, type NavSection } from './navigation';

export function NavSections({ sections, collapsed = false, onNavigate }: { sections: NavSection[]; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="space-y-5">
      {sections.map((section) => (
        <div key={section.label}>
          <p
            className={cn(
              'mb-1.5 px-3 text-[11px] font-medium tracking-wider text-fg-subtle uppercase transition-opacity duration-200',
              collapsed && 'pointer-events-none h-0 opacity-0',
            )}
          >
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const link = (
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150',
                      isActive ? 'bg-primary-soft font-medium text-primary' : 'text-fg-muted hover:bg-surface-raised hover:text-fg',
                      collapsed && 'justify-center px-0',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary" />}
                      <Icon aria-hidden className="size-4.5 shrink-0" />
                      <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
                    </>
                  )}
                </NavLink>
              );
              return (
                <li key={item.to}>
                  {collapsed ? (
                    <Tooltip content={item.label} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const auth = useAuth();
  const sections = visibleSections(auth.viewer);

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-surface transition-[width] duration-300 ease-out lg:flex',
        collapsed ? 'w-[72px]' : 'w-64',
      )}
    >
      <div className={cn('flex h-16 items-center gap-3 border-b px-4', collapsed && 'justify-center px-0')}>
        <BrandMark className="size-8" />
        <div className={cn('min-w-0 transition-opacity duration-200', collapsed && 'sr-only')}>
          <p className="truncate text-sm font-semibold tracking-tight text-fg">{auth.institute?.name ?? 'Institute OS'}</p>
          <p className="truncate text-xs text-fg-subtle">Institute OS</p>
        </div>
      </div>

      <div className={cn('flex-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
        <NavSections sections={sections} collapsed={collapsed} />
      </div>

      <div className={cn('border-t p-3', collapsed && 'px-2')}>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className={cn(
            'flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? <ChevronsRight aria-hidden className="size-4.5" /> : <ChevronsLeft aria-hidden className="size-4.5" />}
          <span className={cn(collapsed && 'sr-only')}>Collapse</span>
        </button>
      </div>
    </aside>
  );
}
