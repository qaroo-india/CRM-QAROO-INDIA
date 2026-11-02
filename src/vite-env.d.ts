/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL. Defaults to "/api/v1" (same origin, proxied in development). */
  readonly VITE_API_URL?: string;
  /** Name shown before institute settings load. */
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
