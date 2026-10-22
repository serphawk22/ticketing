import { db } from './db.js';
import {
  encryptBankData,
  decryptBankData,
  maskAccountNumber,
  isValidIFSC,
  isValidGithubUrl,
  isValidLinkedinUrl,
} from './bankCrypto.js';

/**
 * Retrieves the full profile for a specific authenticated user:
 * - Personal details (name, email, age, joined date, github, linkedin, avatar)
 * - Employment details (department, base_salary, last_payment_date, payment_status)
 * - Bank details (account_holder_name, bank_name, masked account number, ifsc_code)
 */
export async function getUserProfile(userId) {
  if (!userId) return null;

  const user = await db
    .prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?')
    .get(Number(userId));
  if (!user) return null;

  const employee = await db
    .prepare(
      `SELECT id, department, title, base_salary, salary_currency, last_payment_date, payment_status, secondary_email
       FROM employees
       WHERE user_id = ? OR (user_id IS NULL AND email IS NOT NULL AND email = ?)`
    )
    .get(Number(userId), user.email || '');

  let profile = null;
  try {
    profile = await db
      .prepare('SELECT * FROM user_profiles WHERE user_id = ?')
      .get(Number(userId));
  } catch (err) {
    console.error('[profiles] Failed to fetch user_profiles:', err.message);
  }

  let bank = null;
  try {
    bank = await db
      .prepare('SELECT * FROM user_bank_details WHERE user_id = ?')
      .get(Number(userId));
  } catch (err) {
    console.error('[profiles] Failed to fetch user_bank_details:', err.message);
  }

  // Decrypt account number if present, and provide both masked and raw
  const decryptedAccount = bank?.account_number_encrypted
    ? decryptBankData(bank.account_number_encrypted)
    : '';

  const isClient = user.role === 'client';

  return {
    id: user.id,
    name: user.name,
    email: user.email || null,
    secondary_email: isClient ? (employee?.secondary_email || null) : null,
    role: user.role,
    created_at: user.created_at,
    avatar_url: profile?.avatar_url || '',
    avatar_storage_key: profile?.avatar_storage_key || '',
    age: profile?.age ?? null,
    github_url: profile?.github_url || '',
    linkedin_url: profile?.linkedin_url || '',
    // Employment & compensation (set by administrator)
    department: isClient ? '' : (employee?.department || ''),
    title: isClient ? '' : (employee?.title || ''),
    base_salary: isClient ? null : (employee?.base_salary ?? null),
    salary_currency: isClient ? 'USD' : (employee?.salary_currency || 'USD'),
    last_payment_date: isClient ? null : (employee?.last_payment_date || null),
    payment_status: isClient ? '' : (employee?.payment_status || ''),
    // Bank details (managed by individual user)
    bank_details: {
      account_holder_name: bank?.account_holder_name || '',
      bank_name: bank?.bank_name || '',
      account_number_masked: bank?.account_number_last4
        ? maskAccountNumber(decryptedAccount || bank.account_number_last4)
        : '',
      account_number: decryptedAccount || '',
      ifsc_code: bank?.ifsc_code || '',
      has_bank_details: Boolean(bank?.account_holder_name || bank?.account_number_encrypted),
    },
  };
}

/**
 * Updates permitted personal fields for an authenticated user:
 * - name (updates users and employees)
 * - age (validated integer 16-120 or null)
 * - github_url (validated URL)
 * - linkedin_url (validated URL)
 *
 * Email and Date joined are immutable.
 */
export async function updatePersonalProfile(userId, { name, age, github_url, linkedin_url }) {
  const user = await db
    .prepare('SELECT id, name, email FROM users WHERE id = ?')
    .get(Number(userId));
  if (!user) throw new Error('User not found.');

  const cleanName = String(name ?? '').trim();
  if (!cleanName) {
    throw new Error('Full name is required.');
  }

  let cleanAge = null;
  if (age !== undefined && age !== null && age !== '') {
    const parsedAge = parseInt(age, 10);
    if (Number.isNaN(parsedAge) || parsedAge < 16 || parsedAge > 120) {
      throw new Error('Age must be a valid number between 16 and 120.');
    }
    cleanAge = parsedAge;
  }

  const cleanGithub = String(github_url ?? '').trim();
  if (cleanGithub && !isValidGithubUrl(cleanGithub)) {
    throw new Error('Invalid GitHub profile URL (e.g. https://github.com/username).');
  }

  const cleanLinkedin = String(linkedin_url ?? '').trim();
  if (cleanLinkedin && !isValidLinkedinUrl(cleanLinkedin)) {
    throw new Error('Invalid LinkedIn profile URL (e.g. https://linkedin.com/in/username).');
  }

  // 1. Update name on users table
  await db
    .prepare('UPDATE users SET name = ? WHERE id = ?')
    .run(cleanName, Number(userId));

  // 2. Mirror name onto employees table
  await db
    .prepare(
      `UPDATE employees
       SET name = ?, updated_at = datetime('now')
       WHERE user_id = ? OR (user_id IS NULL AND email IS NOT NULL AND email = ?)`
    )
    .run(cleanName, Number(userId), user.email || '');

  // 3. Upsert into user_profiles
  const existingProfile = await db
    .prepare('SELECT user_id FROM user_profiles WHERE user_id = ?')
    .get(Number(userId));

  if (existingProfile) {
    await db
      .prepare(
        `UPDATE user_profiles
         SET age = ?, github_url = ?, linkedin_url = ?, updated_at = datetime('now')
         WHERE user_id = ?`
      )
      .run(cleanAge, cleanGithub, cleanLinkedin, Number(userId));
  } else {
    await db
      .prepare(
        `INSERT INTO user_profiles (user_id, age, github_url, linkedin_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(Number(userId), cleanAge, cleanGithub, cleanLinkedin);
  }

  return getUserProfile(userId);
}

/**
 * Updates bank details for an authenticated user:
 * - account_holder_name
 * - bank_name
 * - account_number (encrypted at rest with AES-256-GCM)
 * - ifsc_code (validated format)
 */
export async function updateBankDetails(
  userId,
  { account_holder_name, bank_name, account_number, ifsc_code }
) {
  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(Number(userId));
  if (!user) throw new Error('User not found.');

  const cleanHolder = String(account_holder_name ?? '').trim();
  const cleanBank = String(bank_name ?? '').trim();
  const rawAccount = String(account_number ?? '').trim();
  const cleanIfsc = String(ifsc_code ?? '').trim().toUpperCase();

  if (cleanIfsc && !isValidIFSC(cleanIfsc)) {
    throw new Error('Invalid IFSC code format. Example: SBIN0001234');
  }

  // Existing bank record to preserve encrypted account if not being changed
  const existingBank = await db
    .prepare('SELECT * FROM user_bank_details WHERE user_id = ?')
    .get(Number(userId));

  let encryptedAccount = existingBank?.account_number_encrypted || '';
  let last4 = existingBank?.account_number_last4 || '';

  // Only re-encrypt if a new unmasked account number was provided
  if (rawAccount && !rawAccount.includes('•') && !rawAccount.includes('*')) {
    if (!/^\d{6,30}$/.test(rawAccount)) {
      throw new Error('Account number must contain between 6 and 30 digits.');
    }
    encryptedAccount = encryptBankData(rawAccount);
    last4 = rawAccount.slice(-4);
  }

  if (existingBank) {
    await db
      .prepare(
        `UPDATE user_bank_details
         SET account_holder_name = ?, bank_name = ?,
             account_number_encrypted = ?, account_number_last4 = ?,
             ifsc_code = ?, updated_at = datetime('now')
         WHERE user_id = ?`
      )
      .run(cleanHolder, cleanBank, encryptedAccount, last4, cleanIfsc, Number(userId));
  } else {
    await db
      .prepare(
        `INSERT INTO user_bank_details (
           user_id, account_holder_name, bank_name,
           account_number_encrypted, account_number_last4, ifsc_code,
           created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(Number(userId), cleanHolder, cleanBank, encryptedAccount, last4, cleanIfsc);
  }

  return (await getUserProfile(userId)).bank_details;
}

/**
 * Updates avatar URL and storage key for an authenticated user.
 */
export async function updateAvatar(userId, { avatar_url, avatar_storage_key = '' }) {
  const existingProfile = await db
    .prepare('SELECT user_id FROM user_profiles WHERE user_id = ?')
    .get(Number(userId));

  if (existingProfile) {
    await db
      .prepare(
        `UPDATE user_profiles
         SET avatar_url = ?, avatar_storage_key = ?, updated_at = datetime('now')
         WHERE user_id = ?`
      )
      .run(avatar_url, avatar_storage_key, Number(userId));
  } else {
    await db
      .prepare(
        `INSERT INTO user_profiles (user_id, avatar_url, avatar_storage_key, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(Number(userId), avatar_url, avatar_storage_key);
  }

  return getUserProfile(userId);
}

/**
 * Removes custom avatar for an authenticated user.
 */
export async function deleteAvatar(userId) {
  const profile = await db
    .prepare('SELECT avatar_storage_key FROM user_profiles WHERE user_id = ?')
    .get(Number(userId));

  await db
    .prepare(
      `UPDATE user_profiles
       SET avatar_url = '', avatar_storage_key = '', updated_at = datetime('now')
       WHERE user_id = ?`
    )
    .run(Number(userId));

  return profile?.avatar_storage_key || null;
}
