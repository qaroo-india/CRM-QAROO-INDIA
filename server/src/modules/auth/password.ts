/**
 * Password hashing with Argon2id (the OWASP first choice), using the OWASP
 * minimum profile: 19 MiB memory, 2 iterations, 1 lane. The parameters are
 * encoded in each hash, so they can be raised later without breaking logins.
 */

import { hash, verify } from '@node-rs/argon2';

const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed stored hash must read as "wrong password", never crash login.
    return false;
  }
}

/**
 * A real hash of a random string, verified against when the email is unknown.
 * Without it, "no such user" answers measurably faster than "wrong password",
 * which lets an attacker enumerate staff email addresses.
 */
let dummyHash: Promise<string> | null = null;

export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(`dummy-${Math.random()}`);
  await verifyPassword(await dummyHash, password);
  return false;
}
