import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { encryptData, decryptData } from "../../src/utils/ssh-encryption.js";

describe("utils/ssh-encryption", () => {
  // Generate a random 32-byte key for testing
  const validKey = crypto.randomBytes(32);
  const invalidKey = crypto.randomBytes(32);
  const wrongSizeKey = crypto.randomBytes(16);

  it("should encrypt and decrypt a string correctly", () => {
    const originalText = "super-secret-ssh-key-or-password-1234!@#$";
    const encrypted = encryptData(originalText, validKey);

    expect(encrypted).toBeTypeOf("string");
    // Format should be ivHex:authTagHex:ciphertextHex
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(24); // 12 bytes = 24 hex chars
    expect(parts[1]).toHaveLength(32); // 16 bytes auth tag = 32 hex chars

    const decrypted = decryptData(encrypted, validKey);
    expect(decrypted).toBe(originalText);
  });

  it("should encrypt and decrypt empty strings and unicode characters", () => {
    const unicodeText = "🔑 SSH Key with Emojis 🚀 and Unicode characters: 日本語";
    const encrypted = encryptData(unicodeText, validKey);
    const decrypted = decryptData(encrypted, validKey);
    expect(decrypted).toBe(unicodeText);

    const emptyText = "";
    const encryptedEmpty = encryptData(emptyText, validKey);
    const decryptedEmpty = decryptData(encryptedEmpty, validKey);
    expect(decryptedEmpty).toBe(emptyText);
  });

  it("should generate different ciphertexts and IVs for the same input", () => {
    const plainText = "same-input-text";
    const encrypted1 = encryptData(plainText, validKey);
    const encrypted2 = encryptData(plainText, validKey);

    expect(encrypted1).not.toBe(encrypted2);

    const parts1 = encrypted1.split(":");
    const parts2 = encrypted2.split(":");

    // IVs should be different
    expect(parts1[0]).not.toBe(parts2[0]);
    // Ciphertexts should also be different
    expect(parts1[2]).not.toBe(parts2[2]);
  });

  it("should throw an error if the key is not exactly 32 bytes", () => {
    const text = "test-message";
    expect(() => encryptData(text, wrongSizeKey)).toThrow(/32-byte/);
    expect(() => decryptData("iv:tag:cipher", wrongSizeKey)).toThrow(/32-byte/);
  });

  it("should throw an error when decrypting with an incorrect key", () => {
    const text = "highly-confidential-information";
    const encrypted = encryptData(text, validKey);

    expect(() => decryptData(encrypted, invalidKey)).toThrow();
  });

  it("should throw an error when decrypting corrupted ciphertext or tag", () => {
    const text = "secret-message";
    const encrypted = encryptData(text, validKey);
    const [ivHex, authTagHex, ciphertextHex] = encrypted.split(":");

    // Corrupt the ciphertext
    const corruptedCiphertext = ciphertextHex.substring(0, ciphertextHex.length - 2) + "00";
    const corruptedEncrypted1 = `${ivHex}:${authTagHex}:${corruptedCiphertext}`;
    expect(() => decryptData(corruptedEncrypted1, validKey)).toThrow();

    // Corrupt the auth tag
    const corruptedTag = authTagHex.substring(0, authTagHex.length - 2) + "00";
    const corruptedEncrypted2 = `${ivHex}:${corruptedTag}:${ciphertextHex}`;
    expect(() => decryptData(corruptedEncrypted2, validKey)).toThrow();
  });

  it("should throw an error for invalid input format during decryption", () => {
    expect(() => decryptData("invalid-format-no-colons", validKey)).toThrow(/format/i);
    expect(() => decryptData("only:two", validKey)).toThrow(/format/i);
    expect(() => decryptData("four:colons:in:this:string", validKey)).toThrow(/format/i);
    expect(() => decryptData("::", validKey)).toThrow(/components/i);
  });
});
