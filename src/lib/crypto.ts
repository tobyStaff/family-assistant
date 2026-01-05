import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits

// Use __dirname equivalent for ESM or fallback to cwd
const getDataDir = (): string => {
  try {
    // ESM: Get directory from import.meta.url if available
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      return path.join(__dirname, '..', '..', 'data');
    }
  } catch {
    // Fallback to process.cwd if import.meta unavailable
  }
  return path.join(process.cwd(), 'data');
};

const SALT_PATH = path.join(getDataDir(), 'crypto_salt');

// Module-level cache to prevent race conditions and improve performance
let cachedSalt: Buffer | null = null;
let cachedKey: Buffer | null = null;
let cachedSecret: string | null = null;

/**
 * Get or generate the encryption salt.
 * Salt is stored in the data directory and persists across restarts.
 * Uses module-level caching to prevent race conditions.
 */
function getSalt(): Buffer {
  // Return cached salt if available
  if (cachedSalt) {
    return cachedSalt;
  }

  // Ensure data directory exists
  const dataDir = path.dirname(SALT_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Load existing salt
  if (fs.existsSync(SALT_PATH)) {
    cachedSalt = fs.readFileSync(SALT_PATH);
    return cachedSalt;
  }

  // Generate and save new salt atomically
  const salt = crypto.randomBytes(16);
  const tempPath = `${SALT_PATH}.tmp`;

  try {
    // Write to temp file first, then rename (atomic on POSIX systems)
    fs.writeFileSync(tempPath, salt, { mode: 0o600 });
    fs.renameSync(tempPath, SALT_PATH);
    cachedSalt = salt;
    return salt;
  } catch (error) {
    // Clean up temp file if rename failed
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}

/**
 * Derive encryption key from the ENCRYPTION_SECRET environment variable.
 * Uses scrypt for secure key derivation with a persistent salt.
 * Caches the derived key to avoid expensive re-computation on every operation.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;

  if (!secret) {
    throw new Error('ENCRYPTION_SECRET environment variable is required');
  }

  if (secret.length < 16) {
    throw new Error('ENCRYPTION_SECRET must be at least 16 characters');
  }

  // Return cached key if secret hasn't changed
  if (cachedKey && cachedSecret === secret) {
    return cachedKey;
  }

  // Derive new key (expensive operation)
  const salt = getSalt();
  cachedKey = crypto.scryptSync(secret, salt, KEY_LENGTH);
  cachedSecret = secret;

  return cachedKey;
}

/**
 * Encrypt a string using AES-256-CBC.
 * Returns the encrypted data and IV as hex strings.
 *
 * @param text - Plain text to encrypt
 * @returns Object containing encrypted content and IV
 */
export function encrypt(text: string): { iv: string; content: string } {
  if (typeof text !== 'string') {
    throw new TypeError('Text to encrypt must be a string');
  }

  if (text.length === 0) {
    throw new Error('Cannot encrypt empty string');
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    iv: iv.toString('hex'),
    content: encrypted,
  };
}

/**
 * Decrypt data that was encrypted with the encrypt() function.
 *
 * @param encryptedContent - Hex-encoded encrypted data
 * @param iv - Hex-encoded initialization vector
 * @returns Decrypted plain text
 */
export function decrypt(encryptedContent: string, iv: string): string {
  if (typeof encryptedContent !== 'string' || typeof iv !== 'string') {
    throw new TypeError('Encrypted content and IV must be strings');
  }

  if (encryptedContent.length === 0 || iv.length === 0) {
    throw new Error('Encrypted content and IV cannot be empty');
  }

  const key = getEncryptionKey();
  const ivBuffer = Buffer.from(iv, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer);

  let decrypted = decipher.update(encryptedContent, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
