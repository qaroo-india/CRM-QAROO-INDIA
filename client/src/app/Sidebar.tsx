import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { motion } from 'motion/react';
import { useId } from 'react';
import { NavLink } from 'react-router';
import { BrandMark } from '@/auth/LoginPage';
import { useAuth } from '@/auth/AuthProvider';
import { Tooltip } from '@/components/ui/Menu';
import { cn } from '@/lib/cn';
import { visibleSections, type NavSection } from './navigation';

export function NavSections({ sections, collapsed = false, onNavigate }: { sections: NavSection[]; collapsed?: boolean; onNavigate?: () => void }) {
  // One highlight per menu that glides to the active page (the sidebar and the
  // mobile drawer each get their own).
  const group = useId();
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
                      'group relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-200',
                      isActive ? 'font-medium text-primary' : 'text-fg-muted hover:bg-surface-raised hover:text-fg',
                      collapsed && 'justify-center px-0',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId={`${group}-active`}
                          aria-hidden
                          className="absolute inset-0 rounded-lg bg-primary-soft"
                          transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                        >
                          <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary" />
                        </motion.span>
                      )}
                      <Icon aria-hidden className={cn('relative size-4.5 shrink-0 transition-transform duration-200 ease-out-expo', !isActive && 'group-hover:translate-x-0.5')} />
                      <span className={cn('relative truncate', collapsed && 'sr-only')}>{item.label}</span>
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
        'glass sticky top-0 hidden h-dvh shrink-0 flex-col border-r transition-[width] duration-300 ease-out lg:flex',
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
