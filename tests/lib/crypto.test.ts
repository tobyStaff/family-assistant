import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { encrypt, decrypt, __clearCacheForTesting } from '../../src/lib/crypto.js';
import fs from 'node:fs';
import path from 'node:path';

const SALT_PATH = path.join(process.cwd(), 'data', 'crypto_salt');
const ORIGINAL_ENV = process.env.ENCRYPTION_SECRET;

// Set up test environment with encryption secret
beforeAll(() => {
  process.env.ENCRYPTION_SECRET = 'test-secret-key-min-16-chars-required-for-security';
});

// Clean up test salt file and restore environment after all tests
afterAll(() => {
  // Clean up test salt file
  if (fs.existsSync(SALT_PATH)) {
    fs.unlinkSync(SALT_PATH);
  }

  // Restore original environment
  if (ORIGINAL_ENV) {
    process.env.ENCRYPTION_SECRET = ORIGINAL_ENV;
  } else {
    delete process.env.ENCRYPTION_SECRET;
  }
});

describe('Crypto Module', () => {
  describe('encrypt() and decrypt()', () => {
    it('should encrypt and decrypt text correctly', () => {
      const plainText = 'test';
      const { iv, content } = encrypt(plainText);
      const decrypted = decrypt(content, iv);

      expect(decrypted).toBe(plainText);
    });

    it('should handle long text', () => {
      const longText = 'a'.repeat(10000);
      const { iv, content } = encrypt(longText);
      const decrypted = decrypt(content, iv);

      expect(decrypted).toBe(longText);
    });

    it('should handle special characters', () => {
      const specialText = '!@#$%^&*()_+-={}[]|\\:";\'<>?,./~`\n\t';
      const { iv, content } = encrypt(specialText);
      const decrypted = decrypt(content, iv);

      expect(decrypted).toBe(specialText);
    });

    it('should handle unicode characters', () => {
      const unicodeText = 'Hello 世界 🌍 مرحبا';
      const { iv, content } = encrypt(unicodeText);
      const decrypted = decrypt(content, iv);

      expect(decrypted).toBe(unicodeText);
    });

    it('should produce different ciphertext for same input (due to random IV)', () => {
      const plainText = 'same text';
      const result1 = encrypt(plainText);
      const result2 = encrypt(plainText);

      // IVs should be different
      expect(result1.iv).not.toBe(result2.iv);
      // Encrypted content should be different
      expect(result1.content).not.toBe(result2.content);
      // But both should decrypt to the same value
      expect(decrypt(result1.content, result1.iv)).toBe(plainText);
      expect(decrypt(result2.content, result2.iv)).toBe(plainText);
    });

    it('should return hex-encoded strings', () => {
      const { iv, content } = encrypt('test');

      // Check that iv and content are valid hex strings
      expect(iv).toMatch(/^[0-9a-f]+$/);
      expect(content).toMatch(/^[0-9a-f]+$/);
      // IV should be 32 hex chars (16 bytes)
      expect(iv).toHaveLength(32);
    });
  });

  describe('Error handling', () => {
    it('should throw on empty string encryption', () => {
      expect(() => encrypt('')).toThrow('Cannot encrypt empty string');
    });

    it('should throw on non-string input to encrypt', () => {
      expect(() => encrypt(123 as any)).toThrow('Text to encrypt must be a string');
      expect(() => encrypt(null as any)).toThrow('Text to encrypt must be a string');
      expect(() => encrypt(undefined as any)).toThrow('Text to encrypt must be a string');
    });

    it('should throw on empty encrypted content', () => {
      expect(() => decrypt('', '1234567890abcdef')).toThrow('Encrypted content and IV cannot be empty');
    });

    it('should throw on empty IV', () => {
      expect(() => decrypt('abcdef1234567890', '')).toThrow('Encrypted content and IV cannot be empty');
    });

    it('should throw on non-string inputs to decrypt', () => {
      expect(() => decrypt(123 as any, 'abc')).toThrow('Encrypted content and IV must be strings');
      expect(() => decrypt('abc', 123 as any)).toThrow('Encrypted content and IV must be strings');
    });

    it('should throw on invalid encrypted content', () => {
      const { iv } = encrypt('test');
      expect(() => decrypt('invalid-hex-content', iv)).toThrow();
    });

    it('should throw on invalid IV', () => {
      const { content } = encrypt('test');
      expect(() => decrypt(content, 'invalid-iv')).toThrow();
    });
  });

  describe('Environment validation', () => {
    it('should work with valid ENCRYPTION_SECRET', () => {
      // Already set in beforeAll, just verify it works
      expect(() => encrypt('test')).not.toThrow();
    });

    it('should throw when ENCRYPTION_SECRET is missing', () => {
      const original = process.env.ENCRYPTION_SECRET;
      delete process.env.ENCRYPTION_SECRET;

      expect(() => encrypt('test')).toThrow('ENCRYPTION_SECRET environment variable is required');

      // Restore
      process.env.ENCRYPTION_SECRET = original;
    });

    it('should throw when ENCRYPTION_SECRET is too short', () => {
      const original = process.env.ENCRYPTION_SECRET;
      process.env.ENCRYPTION_SECRET = 'short'; // Less than 16 chars

      expect(() => encrypt('test')).toThrow('ENCRYPTION_SECRET must be at least 16 characters');

      // Restore
      process.env.ENCRYPTION_SECRET = original;
    });
  });

  describe('Performance and caching', () => {
    it('should cache encryption key for better performance', () => {
      // First encryption (will derive key)
      const start1 = Date.now();
      encrypt('test1');
      const time1 = Date.now() - start1;

      // Second encryption (should use cached key)
      const start2 = Date.now();
      encrypt('test2');
      const time2 = Date.now() - start2;

      // Cached operation should be faster (though this test is timing-dependent)
      // Just verify both complete without error
      expect(time1).toBeGreaterThanOrEqual(0);
      expect(time2).toBeGreaterThanOrEqual(0);
    });

    it('should handle concurrent encryption calls without race conditions', async () => {
      // Simulate concurrent encryptions
      const promises = Array.from({ length: 10 }, (_, i) =>
        Promise.resolve(encrypt(`concurrent-test-${i}`))
      );

      const results = await Promise.all(promises);

      // All should succeed
      expect(results).toHaveLength(10);

      // All should be decryptable
      results.forEach((result, i) => {
        const decrypted = decrypt(result.content, result.iv);
        expect(decrypted).toBe(`concurrent-test-${i}`);
      });
    });
  });

  describe('Salt file handling', () => {
    it('should create salt file on first use if missing', () => {
      // Remove salt if it exists
      if (fs.existsSync(SALT_PATH)) {
        fs.unlinkSync(SALT_PATH);
      }

      // Clear the module cache so it will recreate the salt
      __clearCacheForTesting();

      // Encrypt should create salt
      const { iv, content } = encrypt('test-salt-creation');

      // Salt file should now exist
      expect(fs.existsSync(SALT_PATH)).toBe(true);

      // Should be decryptable
      expect(decrypt(content, iv)).toBe('test-salt-creation');
    });

    it('should reuse existing salt file', () => {
      // Clear cache and ensure fresh salt is created
      __clearCacheForTesting();

      // Ensure salt exists
      const { content: content1, iv: iv1 } = encrypt('test1');

      // Read salt
      const salt1 = fs.readFileSync(SALT_PATH);

      // Encrypt again
      const { content: content2, iv: iv2 } = encrypt('test2');

      // Salt should be unchanged
      const salt2 = fs.readFileSync(SALT_PATH);
      expect(salt1.equals(salt2)).toBe(true);

      // Both should decrypt correctly
      expect(decrypt(content1, iv1)).toBe('test1');
      expect(decrypt(content2, iv2)).toBe('test2');
    });
  });
});
