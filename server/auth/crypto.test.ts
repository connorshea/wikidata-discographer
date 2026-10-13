import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { decrypt, encrypt, loadEncKeys } from "./crypto.ts";

const keyA = randomBytes(32).toString("base64");
const keyB = randomBytes(32).toString("base64");
const AAD = "user-1";

function parts(payload: string): [string, string, string, string, string] {
  return payload.split(":") as [string, string, string, string, string];
}

describe("token encryption", () => {
  it("round-trips a token", () => {
    const keys = loadEncKeys({ TOKEN_ENC_KEY: keyA });
    expect(decrypt(encrypt("tok", AAD, keys), AAD, keys)).toBe("tok");
  });

  it("refuses a ciphertext bound to another user", () => {
    const keys = loadEncKeys({ TOKEN_ENC_KEY: keyA });
    expect(() => decrypt(encrypt("tok", AAD, keys), "user-2", keys)).toThrow();
  });

  it("rejects a malformed payload", () => {
    const keys = loadEncKeys({ TOKEN_ENC_KEY: keyA });
    expect(() => decrypt("garbage", AAD, keys)).toThrow(/format/);
  });

  it("rejects a truncated auth tag rather than verifying a shorter one", () => {
    const keys = loadEncKeys({ TOKEN_ENC_KEY: keyA });
    const [v, kid, iv, ct, tag] = parts(encrypt("payload", AAD, keys));
    expect(Buffer.from(tag, "base64url")).toHaveLength(16);
    // Node accepts 4/8/12..16-byte GCM tags by default; every short one must fail here.
    for (const n of [15, 12, 8, 4]) {
      const short = Buffer.from(tag, "base64url").subarray(0, n).toString("base64url");
      expect(() => decrypt([v, kid, iv, ct, short].join(":"), AAD, keys)).toThrow(/format/);
    }
  });

  it("rejects an IV of any length but 12 bytes", () => {
    const keys = loadEncKeys({ TOKEN_ENC_KEY: keyA });
    const [v, kid, iv, ct, tag] = parts(encrypt("payload", AAD, keys));
    expect(Buffer.from(iv, "base64url")).toHaveLength(12);
    for (const bad of [Buffer.alloc(0), Buffer.alloc(8), Buffer.alloc(16)]) {
      expect(() =>
        decrypt([v, kid, bad.toString("base64url"), ct, tag].join(":"), AAD, keys),
      ).toThrow(/format/);
    }
  });

  it("decrypts with the previous key during a rotation, encrypts with the current one", () => {
    const old = loadEncKeys({ TOKEN_ENC_KEY: keyA });
    const ct = encrypt("tok", AAD, old);
    const rotated = loadEncKeys({ TOKEN_ENC_KEY: keyB, TOKEN_ENC_KEY_PREVIOUS: keyA });
    expect(decrypt(ct, AAD, rotated)).toBe("tok");
    expect(parts(encrypt("tok", AAD, rotated))[1]).toBe(rotated[0]!.kid);
  });
});
