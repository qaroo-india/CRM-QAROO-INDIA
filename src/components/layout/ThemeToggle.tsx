import { Monitor, Moon, Sun } from 'lucide-react';
import type { MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { useTheme, type ThemePreference } from '@/providers/ThemeProvider';

const ICONS = { dark: Moon, light: Sun, system: Monitor } as const;
const LABELS: Record<ThemePreference, string> = { dark: 'Dark', light: 'Light', system: 'System' };
const NEXT: Record<ThemePreference, ThemePreference> = { dark: 'light', light: 'system', system: 'dark' };

export function ThemeToggle() {
  const { preference, cyclePreference } = useTheme();
  const Icon = ICONS[preference];

  // The new theme spreads in a circle from the button (View Transitions, where supported).
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || reduce) return cyclePreference();
    const box = event.currentTarget.getBoundingClientRect();
    document.documentElement.style.setProperty('--vt-x', `${box.left + box.width / 2}px`);
    document.documentElement.style.setProperty('--vt-y', `${box.top + box.height / 2}px`);
    doc.startViewTransition(() => flushSync(cyclePreference));
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Theme: ${LABELS[preference]}. Switch to ${LABELS[NEXT[preference]]}.`}
      title={`Theme: ${LABELS[preference]}`}
    >
      <Icon key={preference} aria-hidden className="size-4.5 animate-icon-swap" />
    </Button>
  );
}
