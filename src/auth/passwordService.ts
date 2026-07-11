const HASH_PREFIX = "pbkdf2-sha256";
const HASH_VERSION = "v1";
const ITERATIONS = 120_000;
const KEY_LENGTH_BITS = 256;

export function generateTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const random = bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `Tmp-${random}-9`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations,
    },
    key,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt, ITERATIONS);
  return [HASH_PREFIX, HASH_VERSION, String(ITERATIONS), bytesToBase64(salt), bytesToBase64(hash)].join("$");
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [prefix, version, iterationText, saltText, hashText] = storedHash.split("$");
  if (prefix !== HASH_PREFIX || version !== HASH_VERSION || !iterationText || !saltText || !hashText) {
    return false;
  }

  const iterations = Number(iterationText);
  const expected = base64ToBytes(hashText);
  const actual = await derivePasswordHash(password, base64ToBytes(saltText), iterations);
  return timingSafeEqual(actual, expected);
}
