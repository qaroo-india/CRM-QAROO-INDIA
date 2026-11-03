import { useQuery } from '@tanstack/react-query';
import { Activity, Bell, KeyRound, LogOut, Menu as MenuIcon, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { api } from '@/lib/api';
import { UserAvatar } from '@/components/ui/Avatar';
import { roleLabel, visibleQuickActions } from './navigation';

/** The bell swings, and the badge pops, when the unread count goes up. */
function NotificationBell() {
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
    retry: false,
  });
  const count = unread.data?.unread ?? 0;
  const previous = useRef(count);
  const [rings, setRings] = useState(0);
  useEffect(() => {
    if (count > previous.current) setRings((n) => n + 1);
    previous.current = count;
  }, [count]);
  return (
    <>
      <Bell key={rings} aria-hidden className={rings > 0 ? 'bell-ring size-4.5' : 'size-4.5'} />
      {count > 0 && <UnreadCount count={count} />}
    </>
  );
}

function UnreadCount({ count }: { count: number }) {
  return (
    <span key={count} className="absolute -top-0.5 -right-0.5 grid min-w-4.5 animate-badge-pop place-items-center rounded-full bg-danger px-1 text-[10px] leading-4.5 font-semibold text-white tabular-nums">
      {count > 99 ? '99+' : count}
    </span>
  );
}

interface TopbarProps {
  onOpenMobileNav: () => void;
  onOpenPalette: () => void;
}

export function Topbar({ onOpenMobileNav, onOpenPalette }: TopbarProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const actions = visibleQuickActions(auth.viewer);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-canvas/85 px-4 backdrop-blur-md sm:px-6">
      <div className="flex items-center gap-2 lg:hidden">
        <Button variant="ghost" size="icon" onClick={onOpenMobileNav} aria-label="Open navigation">
          <MenuIcon aria-hidden className="size-5" />
        </Button>
        <div className="rounded-lg bg-white/95 px-2 py-0.5 shadow-sm border border-white/20 shrink-0">
          <img src="/logo.png" alt="Qaroo India Private Limited" className="h-6 w-auto object-contain" />
        </div>
      </div>

      {/* Global search / command palette trigger */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control border border-border-strong bg-surface-sunken px-3 text-sm text-fg-subtle transition-colors hover:border-fg-subtle/60 sm:max-w-md"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        {/* Record search is office work; faculty and students jump between their own pages. */}
        <span className="truncate">{auth.accountType === 'team' ? 'Search students, admissions, courses…' : 'Go to a page…'}</span>
        <kbd className="ml-auto hidden rounded border bg-surface px-1.5 font-mono text-[10px] text-fg-subtle sm:inline">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        {actions.length > 0 && (
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" aria-label="Quick create">
                <Plus aria-hidden className="size-4" />
                <span className="hidden md:inline">New</span>
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Quick create</MenuLabel>
              {actions.map(({ label, to, icon: Icon }) => (
                <MenuItem key={label} icon={<Icon />} onSelect={() => navigate(to)}>
                  {label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        )}

        <Button variant="ghost" size="icon" onClick={() => navigate('/notifications')} aria-label="Notifications" className="relative">
          <NotificationBell />
        </Button>

        <ThemeToggle />

        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="relative ml-1 rounded-full transition-shadow hover:shadow-glow" aria-label="Account menu">
              <span aria-hidden className="avatar-ring" />
              <UserAvatar userId={auth.user?.id ?? ''} name={auth.user?.name ?? '?'} hasPhoto={Boolean(auth.user?.hasPhoto) && auth.accountType !== 'student'} />
            </button>
          </MenuTrigger>
          <MenuContent className="w-60">
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-medium text-fg">{auth.user?.name}</p>
              <p className="truncate text-xs text-fg-subtle">{auth.user?.email}</p>
              {auth.user && <p className="mt-1 text-xs font-medium text-primary">{roleLabel(auth.user)}</p>}
            </div>
            <MenuSeparator />
            <MenuItem icon={<KeyRound />} onSelect={() => navigate('/account')}>
              Account &amp; password
            </MenuItem>
            <MenuItem icon={<Activity />} onSelect={() => navigate('/status')}>
              System status
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<LogOut />} tone="danger" onSelect={() => void auth.signOut().then(() => navigate('/login'))}>
              Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </header>
  );
}
