import crypto from "node:crypto";

/**
 * Encrypts a string using AES-256-GCM.
 *
 * @param text The plaintext string to encrypt.
 * @param key A 32-byte Buffer key.
 * @returns A colon-separated string: `ivHex:authTagHex:ciphertextHex`.
 */
export function encryptData(text: string, key: Buffer): string {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Key must be a 32-byte Buffer (256 bits).");
  }

  // 12 bytes is the standard recommended IV size for GCM to be both secure and efficient.
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let ciphertext = cipher.update(text, "utf8", "hex");
  ciphertext += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext}`;
}

/**
 * Decrypts a string encrypted with AES-256-GCM.
 *
 * @param encryptedText A colon-separated string: `ivHex:authTagHex:ciphertextHex`.
 * @param key A 32-byte Buffer key.
 * @returns The decrypted plaintext string.
 */
export function decryptData(encryptedText: string, key: Buffer): string {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Key must be a 32-byte Buffer (256 bits).");
  }

  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format. Expected three colon-separated parts.");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (!ivHex || !authTagHex || ciphertextHex === undefined) {
    throw new Error("Invalid encrypted text format. Components cannot be empty.");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString("utf8");
}
