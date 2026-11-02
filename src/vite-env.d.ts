/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL. Defaults to "/api/v1" (same origin, proxied in development). */
  readonly VITE_API_URL?: string;
  /** Name shown before institute settings load. */
  readonly VITE_APP_NAME?: string;

  /** Firebase Client Configuration */
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
