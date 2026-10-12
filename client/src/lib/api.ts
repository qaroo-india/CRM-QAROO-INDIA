/**
 * The API client.
 *
 * A thin, typed wrapper over fetch. Every call:
 *   - sends cookies (credentials: 'include') and, on state changes, the
 *     X-CSRF-Token header the server's double-submit check expects;
 *   - unwraps the { success, data } envelope and optionally validates `data`
 *     against a shared Zod schema;
 *   - on 401 TOKEN_EXPIRED, refreshes the session once (shared by concurrent
 *     requests) and retries -- so a 15-minute access token never interrupts
 *     work;
 *   - turns every failure into one ApiRequestError type the UI renders.
 */

import type { ApiFailure, ApiFieldError, ApiSuccess } from '@ims/shared';
import type { ZodType } from 'zod';

export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '');

export class ApiRequestError extends Error {
  override readonly name = 'ApiRequestError';

  constructor(
    /** HTTP status, or 0 when no response arrived at all. */
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: ApiFieldError[],
    /** Quote this when reporting a problem; it locates the server log entry. */
    readonly requestId?: string,
    /** Structured context from the server, e.g. duplicate candidates. */
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** True when the API could not be reached, as opposed to it rejecting the request. */
  get isUnreachable(): boolean {
    return this.code === 'NETWORK_ERROR' || this.code === 'API_UNREACHABLE';
  }

  /** Field-level message for a form input, if the server sent one. */
  fieldError(path: string): string | undefined {
    return this.fields?.find((f) => f.path === path)?.message;
  }
}

/* ------------------------------------------------------------------ *
 * Session plumbing
 * ------------------------------------------------------------------ */

let csrfToken: string | null = null;

/** Called whenever the server hands out a token (session responses, /auth/csrf). */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)ims_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

type SessionEvent = 'expired' | 'password-change-required';
const listeners = new Set<(event: SessionEvent) => void>();

/** AuthProvider subscribes to learn when the session ends mid-use. */
export function onSessionEvent(listener: (event: SessionEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: SessionEvent): void {
  for (const listener of listeners) listener(event);
}

let refreshInFlight: Promise<boolean> | null = null;

/** Refresh the session once, however many requests discovered the expiry. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken ?? readCsrfCookie() ?? '' },
      });
      if (!res.ok) return false;
      const body = (await res.json()) as ApiSuccess<{ csrfToken?: string }>;
      if (body.data?.csrfToken) setCsrfToken(body.data.csrfToken);
      return true;
    } catch {
      return false;
    } finally {
      // Let the next expiry trigger a fresh refresh.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions<T> {
  method?: HttpMethod;
  body?: unknown;
  /** Validate the response data against this schema. */
  schema?: ZodType<T>;
  signal?: AbortSignal;
  /** Extra headers, e.g. Idempotency-Key for payments. */
  headers?: Record<string, string>;
  /**
   * Non-2xx statuses whose body is still a success envelope. The health check
   * answers 503 with a full report when the database is down.
   */
  acceptStatuses?: readonly number[];
  /** Internal: set on the retry after a refresh, to prevent loops. */
  isRetry?: boolean;
}

function buildHeaders(method: HttpMethod, body: unknown, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', ...extra };
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const token = csrfToken ?? readCsrfCookie();
    if (token) headers['X-CSRF-Token'] = token;
  }
  return headers;
}

async function send(path: string, method: HttpMethod, body: unknown, options: RequestOptions<unknown>): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: buildHeaders(method, body, options.headers),
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    // A cancelled query is not a failure; let TanStack Query handle it.
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and that the API is running.');
  }
}

/** Throw the right ApiRequestError for a non-success response. */
async function failureFrom(response: Response): Promise<ApiRequestError> {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return response.status >= 500
      ? new ApiRequestError(response.status, 'API_UNREACHABLE', 'The API server is not responding.', undefined, requestId)
      : new ApiRequestError(response.status, 'UNEXPECTED_RESPONSE', `Unexpected response (${response.status}) from the server.`, undefined, requestId);
  }
  const payload = (await response.json()) as ApiFailure;
  if (payload && payload.success === false) {
    return new ApiRequestError(response.status, payload.error.code, payload.error.message, payload.error.fields, payload.error.requestId ?? requestId, payload.error.details);
  }
  return new ApiRequestError(response.status, 'UNEXPECTED_RESPONSE', `Unexpected response (${response.status}) from the server.`, undefined, requestId);
}

/** Retry once after a silent refresh; report session problems to AuthProvider. */
async function handleAuthFailure<T>(
  error: ApiRequestError,
  retry: () => Promise<T>,
  isRetry: boolean | undefined,
): Promise<T> {
  if (error.status === 401 && error.code === 'TOKEN_EXPIRED' && !isRetry) {
    if (await refreshSession()) return retry();
    emit('expired');
  } else if (error.status === 401 && (error.code === 'SESSION_REVOKED' || error.code === 'SESSION_EXPIRED')) {
    emit('expired');
  } else if (error.status === 403 && error.code === 'PASSWORD_CHANGE_REQUIRED') {
    emit('password-change-required');
  }
  throw error;
}

export async function apiRequest<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, schema, acceptStatuses = [] } = options;
  const response = await send(path, method, body, options as RequestOptions<unknown>);
  const requestId = response.headers.get('x-request-id') ?? undefined;

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (response.ok || acceptStatuses.includes(response.status)) {
    if (!contentType.includes('application/json')) {
      throw new ApiRequestError(response.status, 'UNEXPECTED_RESPONSE', `Unexpected response (${response.status}) from the server.`, undefined, requestId);
    }
    const payload = (await response.json()) as ApiSuccess<unknown> | ApiFailure;
    if (payload.success !== true) {
      throw new ApiRequestError(response.status, 'UNEXPECTED_RESPONSE', `Unexpected response (${response.status}) from the server.`, undefined, requestId);
    }
    if (!schema) return payload.data as T;
    const parsed = schema.safeParse(payload.data);
    if (!parsed.success) {
      console.error('API contract mismatch', { path, issues: parsed.error.issues });
      throw new ApiRequestError(
        response.status,
        'CONTRACT_MISMATCH',
        'The server sent data in an unexpected format. The app and server may be out of date with each other.',
        undefined,
        requestId,
      );
    }
    return parsed.data;
  }

  const error = await failureFrom(response);
  return handleAuthFailure(error, () => apiRequest<T>(path, { ...options, isRetry: true }), options.isRetry);
}

type ReadOptions<T> = Omit<RequestOptions<T>, 'method' | 'body'>;
type WriteOptions<T> = Omit<RequestOptions<T>, 'method' | 'body'>;

/** Build a query string, skipping empty values. Arrays become comma-separated. */
export function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  get: <T>(path: string, options?: ReadOptions<T>) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: WriteOptions<T>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown, options?: WriteOptions<T>) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, options?: WriteOptions<T>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body: body ?? {} }),
  delete: <T>(path: string, options?: WriteOptions<T>) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};

/* ------------------------------------------------------------------ *
 * Files
 * ------------------------------------------------------------------ */

function filenameFrom(response: Response, fallback: string): string {
  const header = response.headers.get('content-disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) return decodeURIComponent(star[1]!);
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? fallback;
}

export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

/** Fetch a generated file (PDF, Excel) and return it as a Blob. */
export async function fetchFile(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; fallbackName?: string; isRetry?: boolean } = {},
): Promise<DownloadedFile> {
  const method = options.method ?? 'GET';
  const response = await send(path, method, options.method === 'POST' ? (options.body ?? {}) : undefined, {});
  if (!response.ok) {
    const error = await failureFrom(response);
    return handleAuthFailure(error, () => fetchFile(path, { ...options, isRetry: true }), options.isRetry);
  }
  return { blob: await response.blob(), fileName: filenameFrom(response, options.fallbackName ?? 'download') };
}

/** Hand a Blob to the browser's save dialog. */
export function saveBlob({ blob, fileName }: DownloadedFile): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Upload multipart form data (documents, imports). */
export function upload<T>(path: string, form: FormData): Promise<T> {
  return apiRequest<T>(path, { method: 'POST', body: form });
}
