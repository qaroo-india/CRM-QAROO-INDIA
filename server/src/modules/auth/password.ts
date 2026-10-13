/**
 * Password hashing with Argon2id (the OWASP first choice), using the OWASP
 * minimum profile: 19 MiB memory, 2 iterations, 1 lane. The parameters are
 * encoded in each hash, so they can be raised later without breaking logins.
 */

import { hash, verify } from '@node-rs/argon2';
import { isTest } from '../../config/env';

/** OWASP minimum, used everywhere except the automated tests. */
const OWASP_PROFILE = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
/**
 * The test suite hashes hundreds of throwaway passwords. At 19 MiB each, a
 * machine short on memory had Argon2's native code abort mid-run, so tests use
 * a light profile. Verification reads the parameters from each hash, so the
 * two never mix up.
 */
const TEST_PROFILE = { memoryCost: 1_024, timeCost: 1, parallelism: 1 } as const;
const OPTIONS = isTest ? TEST_PROFILE : OWASP_PROFILE;

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
