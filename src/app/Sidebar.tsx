import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { motion } from 'motion/react';
import { useId } from 'react';
import { NavLink } from 'react-router';
import { BrandLogo, BrandMark } from '@/auth/LoginPage';
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
      <div className={cn('flex h-16 items-center border-b px-3.5', collapsed ? 'justify-center px-0' : 'justify-start gap-2.5')}>
        {collapsed ? (
          <BrandMark className="size-9" />
        ) : (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="rounded-lg bg-white/95 px-2 py-1 shadow-sm border border-white/20 shrink-0">
              <img src="/logo.png" alt="Qaroo India Private Limited" className="h-7 w-auto object-contain" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold tracking-tight text-fg" title={auth.institute?.name ?? 'Qaroo India Private Limited'}>
                {auth.institute?.name ?? 'Qaroo India Private Limited'}
              </p>
              <p className="truncate text-[10px] text-fg-subtle">Management Portal</p>
            </div>
          </div>
        )}
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
