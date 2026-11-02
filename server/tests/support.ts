/**
 * Test harness: an app on a throwaway database, users with exact
 * permissions, and a signed-in client that behaves like the browser
 * (cookie jar + CSRF header on every state change).
 */

import { ALL_PERMISSIONS, type Permission, type Role } from '@ims/shared';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app';
import { db } from '../src/db';
import { runMigrations } from '../src/db/migrator';
import { users, type User } from '../src/db/schema';
import { seedDatabase } from '../src/db/seeders';
import { hashPassword } from '../src/modules/auth/password';
import { loadSettings } from '../src/services/settings';

export const TEST_PASSWORD = 'Correct-Horse-42';

let app: Express | null = null;

/** Migrate, seed and build the app once per test file. */
export async function bootstrap(): Promise<Express> {
  if (app) return app;
  await runMigrations(db);
  await seedDatabase(db);
  // Tests also call services directly, outside a request.
  await loadSettings();
  app = createApp();
  return app;
}

let userCounter = 0;
let cachedHash: string | null = null;

export interface TestUserOptions {
  role?: Role;
  permissions?: Permission[];
  name?: string;
  email?: string;
  mustChangePassword?: boolean;
}

/** Insert a user directly (bypassing the API) with a known password. */
export async function createTestUser(options: TestUserOptions = {}): Promise<User> {
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  userCounter += 1;
  const role = options.role ?? 'staff';
  return await db
    .insert(users)
    .values({
      name: options.name ?? `Test ${role} ${userCounter}`,
      email: options.email ?? `${role}${userCounter}-${Date.now()}@test.local`,
      passwordHash: cachedHash,
      role,
      permissions: role === 'owner' ? [ALL_PERMISSIONS] : (options.permissions ?? []),
      mustChangePassword: options.mustChangePassword ?? false,
    })
    .returning()
    .get();
}

export type Agent = ReturnType<typeof request.agent>;

export interface Client {
  agent: Agent;
  csrf: string;
  user: User;
  get: (url: string) => request.Test;
  post: (url: string, body?: unknown) => request.Test;
  patch: (url: string, body?: unknown) => request.Test;
  put: (url: string, body?: unknown) => request.Test;
  del: (url: string) => request.Test;
}

/** Fetch a CSRF token for an agent (sets the readable cookie in its jar). */
export async function csrfFor(agent: Agent): Promise<string> {
  const res = await agent.get('/api/v1/auth/csrf').expect(200);
  return res.body.data.csrfToken as string;
}

export async function signIn(target: Express, user: User, password = TEST_PASSWORD): Promise<Client> {
  const agent = request.agent(target);
  const csrf = await csrfFor(agent);
  await agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', csrf)
    .send({ email: user.email, password })
    .expect(200);

  const withCsrf = (test: request.Test) => test.set('X-CSRF-Token', csrf);
  return {
    agent,
    csrf,
    user,
    get: (url) => agent.get(url),
    post: (url, body) => withCsrf(agent.post(url)).send((body ?? {}) as object),
    patch: (url, body) => withCsrf(agent.patch(url)).send((body ?? {}) as object),
    put: (url, body) => withCsrf(agent.put(url)).send((body ?? {}) as object),
    del: (url) => withCsrf(agent.delete(url)),
  };
}

/** Create a user with the given access and return a signed-in client. */
export async function clientWith(target: Express, options: TestUserOptions = {}): Promise<Client> {
  return await signIn(target, await createTestUser(options));
}

export async function ownerClient(target: Express): Promise<Client> {
  return await clientWith(target, { role: 'owner' });
}
