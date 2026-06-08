import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "../../src/telegraph/token-encryption.js";

describe("token-encryption", () => {
  const KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("should encrypt and decrypt a token", () => {
    const key = Buffer.from(KEY_HEX, "hex");
    const token = "my-secret-telegraph-token-12345";
    const encrypted = encryptToken(token, key);
    expect(encrypted).not.toBe(token);
    const decrypted = decryptToken(encrypted, key);
    expect(decrypted).toBe(token);
  });

  it("should produce different ciphertexts for the same token (unique IV)", () => {
    const key = Buffer.from(KEY_HEX, "hex");
    const token = "same-token";
    const a = encryptToken(token, key);
    const b = encryptToken(token, key);
    expect(a).not.toBe(b);
  });

  it("should fail with wrong key", () => {
    const keyA = Buffer.from(KEY_HEX, "hex");
    const keyB = Buffer.from("fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210", "hex");
    const encrypted = encryptToken("my-token", keyA);
    expect(() => decryptToken(encrypted, keyB)).toThrow();
  });
});
