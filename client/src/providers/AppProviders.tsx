import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/Menu';
import { createQueryClient } from '@/lib/queryClient';
import { ThemeProvider, useTheme } from './ThemeProvider';

interface AppProvidersProps {
  children: ReactNode;
  /** Tests pass their own client to control retries and caching. */
  queryClient?: QueryClient;
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{ className: 'font-sans' }}
    />
  );
}

/** Every app-wide provider, in one place, so tests can render the real tree. */
export function AppProviders({ children, queryClient }: AppProvidersProps) {
  const [client] = useState(() => queryClient ?? createQueryClient());

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        {/* "user": honour the OS reduced-motion setting in every animation. */}
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={250}>
            {children}
            <ThemedToaster />
          </TooltipProvider>
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
