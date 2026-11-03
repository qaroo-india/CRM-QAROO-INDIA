/**
 * Authenticated layout: sidebar, top bar, animated page area, mobile
 * navigation drawer and the command palette.
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useLocation, useOutlet } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { DialogRoot, DrawerContent } from '@/components/ui/Dialog';
import { LoadingBlock } from '@/components/ui/Feedback';
import { AmbientBackground, BackToTop, RouteProgress } from '@/components/visual/Ambient';
import { useCardSpotlight, useSmoothScroll } from '@/components/visual/effects';
import { CommandPalette } from './CommandPalette';
import { visibleSections } from './navigation';
import { ShortcutsDialog, useShortcuts } from './Shortcuts';
import { NavSections, Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

const SIDEBAR_KEY = 'ims-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell() {
  const auth = useAuth();
  const location = useLocation();
  const outlet = useOutlet();
  const reduceMotion = useReducedMotion();
  useSmoothScroll();
  useCardSpotlight();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const shortcuts = useShortcuts(auth.viewer, openPalette);

  const toggleSidebar = useCallback(() => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, value ? '0' : '1');
      } catch {
        // Not persisted; still toggles for this session.
      }
      return !value;
    });
  }, []);

  // Ctrl/Cmd+K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close the mobile drawer on navigation.
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-dvh">
      <AmbientBackground />
      <RouteProgress />
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px]">
            <Suspense fallback={<LoadingBlock />}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={location.pathname}
                  initial={reduceMotion ? false : { opacity: 0, y: 10, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -6, filter: 'blur(4px)' }}
                  transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
                >
                  {outlet}
                </motion.div>
              </AnimatePresence>
            </Suspense>
          </div>
        </main>
      </div>

      <DialogRoot open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerContent side="left" width="md" title={auth.institute?.name ?? 'Qaroo'} description="Navigation" className="sm:max-w-xs">
          <NavSections sections={visibleSections(auth.viewer)} onNavigate={() => setMobileOpen(false)} />
        </DrawerContent>
      </DialogRoot>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsDialog open={shortcuts.helpOpen} onOpenChange={shortcuts.setHelpOpen} goes={shortcuts.goes} />
      <BackToTop />
    </div>
  );
}
