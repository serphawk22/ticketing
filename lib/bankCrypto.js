import crypto from 'crypto';

/**
 * Derives a 32-byte key for AES-256-GCM encryption of bank details.
 * Uses BANK_ENCRYPTION_KEY or ENCRYPTION_SECRET from environment,
 * falling back to a deterministic SHA-256 hash of a secure default.
 */
function getEncryptionKey() {
  const secret =
    process.env.BANK_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_SECRET ||
    process.env.OUTLOOK_PASSWORD ||
    'ticketing-management-system-bank-encryption-salt-2026';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext string (e.g., bank account number) using AES-256-GCM.
 * Format: iv:authTag:encryptedData (all hex-encoded).
 */
export function encryptBankData(text) {
  if (!text || typeof text !== 'string') return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Returns null or empty string on failure.
 */
export function decryptBankData(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string' || !ciphertext.includes(':')) {
    return '';
  }

  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return '';

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('[bankCrypto] Decryption error:', error.message);
    return '';
  }
}

/**
 * Masks an account number, showing only the last 4 characters.
 * Example: "123456789012" -> "••••••••9012"
 */
export function maskAccountNumber(accountNumber) {
  if (!accountNumber) return '';
  const str = String(accountNumber).trim();
  if (str.length <= 4) return str;
  const last4 = str.slice(-4);
  return '•'.repeat(Math.max(4, str.length - 4)) + last4;
}

/**
 * Validates Indian Financial System Code (IFSC).
 * Standard format: 4 alphabetic characters, '0' (zero), 6 alphanumeric characters.
 * Example: SBIN0001234, HDFC0000240, ICIC0000001
 */
export function isValidIFSC(code) {
  if (!code || typeof code !== 'string') return false;
  const clean = code.trim().toUpperCase();
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(clean);
}

/**
 * Validates GitHub profile URL.
 */
export function isValidGithubUrl(url) {
  if (!url) return true; // Optional field
  const trimmed = url.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    return parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com';
  } catch {
    return false;
  }
}

/**
 * Validates LinkedIn profile URL.
 */
export function isValidLinkedinUrl(url) {
  if (!url) return true; // Optional field
  const trimmed = url.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    return parsed.hostname.includes('linkedin.com');
  } catch {
    return false;
  }
}

