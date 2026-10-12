import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useTheme, type ThemePreference } from '@/providers/ThemeProvider';

const ICONS = { dark: Moon, light: Sun, system: Monitor } as const;
const LABELS: Record<ThemePreference, string> = { dark: 'Dark', light: 'Light', system: 'System' };
const NEXT: Record<ThemePreference, ThemePreference> = { dark: 'light', light: 'system', system: 'dark' };

export function ThemeToggle() {
  const { preference, cyclePreference } = useTheme();
  const Icon = ICONS[preference];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cyclePreference}
      aria-label={`Theme: ${LABELS[preference]}. Switch to ${LABELS[NEXT[preference]]}.`}
      title={`Theme: ${LABELS[preference]}`}
    >
      <Icon aria-hidden className="size-4.5" />
    </Button>
  );
}
