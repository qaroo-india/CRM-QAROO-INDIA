/**
 * Keyboard shortcuts:
 *   /          open search (as does Ctrl/Cmd K)
 *   ?          show these shortcuts
 *   G then X   go to a page, e.g. G D for the dashboard home, G S for students
 * Only pages in the signed-in person's menu get a key, and nothing fires while
 * typing in a field or while a dialog is open.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { DialogContent, DialogRoot } from '@/components/ui/Dialog';
import { visibleItems, type Viewer } from './navigation';

/** One letter per page; the same letter means the same idea in the portal. */
const KEY_FOR_PATH: Record<string, string> = {
  '/': 'd',
  '/portal': 'd',
  '/leads': 'l',
  '/students': 's',
  '/admissions': 'a',
  '/payments': 'p',
  '/portal/fees': 'p',
  '/instalments': 'i',
  '/expenses': 'x',
  '/batches': 'b',
  '/schedule': 'c',
  '/portal/classes': 'c',
  '/attendance': 't',
  '/portal/attendance': 't',
  '/exams': 'e',
  '/portal/exams': 'e',
  '/materials': 'm',
  '/portal/materials': 'm',
  '/certificates': 'f',
  '/portal/certificates': 'f',
  '/reports': 'r',
  '/notifications': 'n',
  '/tasks': 'k',
  '/leave': 'v',
  '/inventory': 'y',
  '/staff': 'u',
  '/account': 'o',
};

interface Go {
  key: string;
  to: string;
  label: string;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function useShortcuts(viewer: Viewer, onOpenPalette: () => void) {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const goes = useMemo<Go[]>(() => {
    const seen = new Set<string>();
    const list: Go[] = [];
    for (const item of [...visibleItems(viewer), { to: '/account', label: 'Account & password' }]) {
      const key = KEY_FOR_PATH[item.to];
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push({ key, to: item.to, label: item.label });
    }
    return list;
  }, [viewer]);

  // Latest values for the one long-lived listener.
  const latest = useRef({ goes, navigate, onOpenPalette });
  latest.current = { goes, navigate, onOpenPalette };

  useEffect(() => {
    let waitingSince = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (document.body.hasAttribute('data-scroll-locked')) return; // a dialog is open
      if (e.key === '/') {
        e.preventDefault();
        latest.current.onOpenPalette();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'g' && !waitingSince) {
        waitingSince = Date.now();
        return;
      }
      if (waitingSince && Date.now() - waitingSince < 1500) {
        const hit = latest.current.goes.find((g) => g.key === key);
        if (hit) {
          e.preventDefault();
          latest.current.navigate(hit.to);
        }
      }
      waitingSince = 0;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { helpOpen, setHelpOpen, goes };
}

export function ShortcutsDialog({ open, onOpenChange, goes }: { open: boolean; onOpenChange: (open: boolean) => void; goes: Go[] }) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" description="Work without the mouse. Press ? any time to see this list." size="md">
        <div className="grid gap-6 sm:grid-cols-2">
          <section className="space-y-2">
            <h3 className="text-xs font-medium tracking-wider text-fg-subtle uppercase">Anywhere</h3>
            <dl className="space-y-2 text-sm">
              <Row label="Search and commands" keys={['/']} />
              <Row label="Search (also)" keys={['Ctrl', 'K']} />
              <Row label="This list" keys={['?']} />
            </dl>
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-medium tracking-wider text-fg-subtle uppercase">Go to</h3>
            <dl className="space-y-2 text-sm">
              {goes.map((g) => (
                <Row key={g.key} label={g.label} keys={['G', g.key.toUpperCase()]} />
              ))}
            </dl>
          </section>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function Row({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="flex shrink-0 items-center gap-1">
        {keys.map((k, i) => (
          <span key={k + i} className="flex items-center gap-1">
            {i > 0 && <span className="text-xs text-fg-subtle">then</span>}
            <kbd className="kbd">{k}</kbd>
          </span>
        ))}
      </dd>
    </div>
  );
}
