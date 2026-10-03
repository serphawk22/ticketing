import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from './db';

// Same cost factor the seeded accounts use, so there is one hashing path in
// the app rather than a second one for admin-created accounts.
const BCRYPT_ROUNDS = 10;

// Ambiguous glyphs (l/1, I, O/0) are left out: these passwords get read off a
// screen and typed by hand at first login.
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

export const TEMP_PASSWORD_LENGTH = 16;

function pick(set) {
  // randomInt is unbiased; Math.random is not, and a predictable character
  // would weaken the one credential an admin never chose.
  return set[crypto.randomInt(set.length)];
}

/**
 * A random temporary password, guaranteed to contain a lowercase letter, an
 * uppercase letter, a digit and a symbol so it satisfies the same rules the
 * change-password form enforces.
 *
 * The plaintext is returned exactly once, to be emailed, and is never written
 * anywhere: only its bcrypt hash reaches the database.
 */
export function generateTemporaryPassword(length = TEMP_PASSWORD_LENGTH) {
  const size = Math.max(12, Number(length) || TEMP_PASSWORD_LENGTH);
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];

  while (chars.length < size) chars.push(pick(ALL));

  // Shuffle so the guaranteed characters are not always in the same places.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

/**
 * The rules a replacement password has to satisfy. These mirror the character
 * classes generateTemporaryPassword guarantees, so a new password can never
 * come out weaker than the temporary one it replaces.
 *
 * Returns a list of problems rather than a boolean so the caller can tell the
 * user exactly what is missing.
 */
export function passwordProblems(password) {
  const value = String(password ?? '');
  const problems = [];

  if (value.length < 12) problems.push('at least 12 characters');
  if (!/[a-z]/.test(value)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(value)) problems.push('an uppercase letter');
  if (!/[0-9]/.test(value)) problems.push('a number');
  if (!/[^A-Za-z0-9]/.test(value)) problems.push('a symbol');

  return problems;
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, bcrypt.genSaltSync(BCRYPT_ROUNDS));
}

export async function getUserByEmail(email) {
  if (!email) return null;
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
}

export async function getUserById(id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
}

/**
 * Creates the login account behind a directory entry. Returns the plaintext
 * temporary password alongside the row so the caller can put it in the invite
 * email; the database only ever sees the hash.
 */
export async function createUserWithTempPassword({ name, email, role }) {
  const tempPassword = generateTemporaryPassword();

  const info = await db
    .prepare(
      `INSERT INTO users (name, email, password, role, must_change_password)
       VALUES (?, ?, ?, ?, 1)`
    )
    .run(name, email, hashPassword(tempPassword), role);

  return { id: info.lastInsertRowid, tempPassword };
}

/**
 * Issues a fresh temporary password for an existing account. Used by "Resend
 * invite", which cannot reuse the original password because only its hash was
 * ever stored.
 */
export async function resetUserPassword(userId) {
  const tempPassword = generateTemporaryPassword();
  await db
    .prepare(
      'UPDATE users SET password = ?, must_change_password = 1 WHERE id = ?'
    )
    .run(hashPassword(tempPassword), Number(userId));
  return tempPassword;
}

export async function setUserPassword(userId, plain) {
  await db
    .prepare(
      'UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?'
    )
    .run(hashPassword(plain), Number(userId));
}

/** Clears the forced-reset flag, e.g. when an admin resets it by hand. */
export async function clearMustChangePassword(userId) {
  await db
    .prepare('UPDATE users SET must_change_password = 0 WHERE id = ?')
    .run(Number(userId));
}

/**
 * Keeps the login account in step with the directory entry. Employees and
 * users are separate tables joined only by email, so an edit to one has to be
 * mirrored onto the other or the next login uses stale details.
 */
export async function syncUserFromEmployee({ email, previousEmail, name, role }) {
  const user = await getUserByEmail(previousEmail || email);
  if (!user) return null;

  await db
    .prepare('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?')
    .run(name, email, role, user.id);

  return getUserById(user.id);
}

export async function deleteUserByEmail(email) {
  const info = await db
    .prepare('DELETE FROM users WHERE email = ?')
    .run(String(email).trim().toLowerCase());
  return info.rowCount;
}

/** Sessions are keyed by user, so they go with the account. */
export async function deleteUserSessions(userId) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(userId));
}