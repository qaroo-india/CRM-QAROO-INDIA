/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Where the dev server forwards /api requests. 127.0.0.1 rather than
  // "localhost": Node may resolve localhost to IPv6 ::1 first, which misses a
  // server bound to IPv4 loopback and fails with a confusing ECONNREFUSED.
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:5000';

  return {
    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@ims/shared': fileURLToPath(new URL('./src/shared/index.ts', import.meta.url)),
      },
    },

    server: {
      port: 5173,
      strictPort: true,
      // Same-origin in development: the browser calls /api on :5173 and Vite
      // forwards it, so cookies work without any cross-site configuration.
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: false,
        },
      },
    },

    preview: {
      port: 4173,
      strictPort: true,
    },

    build: {
      sourcemap: true,
      target: 'es2022',
      emptyOutDir: false,
      // The 3D campus scene (three.js) is one ~540 kB chunk, loaded lazily on
      // the login and home pages only; everything on the startup path stays
      // well under 500 kB.
      chunkSizeWarningLimit: 600,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 30 },
              { name: 'motion', test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/, priority: 20 },
              { name: 'ui', test: /node_modules[\\/](radix-ui|@radix-ui|@floating-ui|cmdk|sonner|react-remove-scroll|react-remove-scroll-bar|aria-hidden|use-callback-ref|use-sidecar|react-style-singleton|detect-node-es|get-nonce|tslib)[\\/]/, priority: 10 },
              { name: 'data', test: /node_modules[\\/](@tanstack|react-hook-form|@hookform)[\\/]/, priority: 10 },
            ],
          },
        },
      },
    },

    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
