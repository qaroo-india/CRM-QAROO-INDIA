import { Monitor, Moon, Sun } from 'lucide-react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { useTheme, type ThemePreference } from '@/providers/ThemeProvider';

const ICONS = { dark: Moon, light: Sun, system: Monitor } as const;
const LABELS: Record<ThemePreference, string> = { dark: 'Dark', light: 'Light', system: 'System' };
const NEXT: Record<ThemePreference, ThemePreference> = { dark: 'light', light: 'system', system: 'dark' };

export function ThemeToggle() {
  const { preference, cyclePreference } = useTheme();
  const Icon = ICONS[preference];

  // Cross-fade the page between themes where the browser supports it.
  const toggle = () => {
    const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || reduce) return cyclePreference();
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
