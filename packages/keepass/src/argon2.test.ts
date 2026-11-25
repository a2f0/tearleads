import { describe, expect, test } from "bun:test";
import { CryptoEngine } from "kdbxweb";
import { kdbxArgon2 } from "./argon2";

const encoder = new TextEncoder();
const password = encoder.encode("correct horse battery staple").buffer;
const salt = encoder.encode("tearleads-keepass-salt").buffer;

function hex(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("hex");
}

// Expected tags computed independently with @noble/hashes argon2d/argon2id
// (t=3, m=1024 KiB, p=2, 32 bytes, version 0x13); hash-wasm must agree, and
// kdbxweb's KiB memory argument must reach it unchanged.
describe("kdbxArgon2", () => {
  test("derives the Argon2d tag", async () => {
    const tag = await kdbxArgon2(
      password,
      salt,
      1024,
      3,
      32,
      2,
      CryptoEngine.Argon2TypeArgon2d,
      0x13,
    );
    expect(hex(tag)).toBe(
      "2252b5021534a8571716bef0b8a73d26f1a44f93c0c41adaf57207b77e15c0c2",
    );
  });

  test("derives the Argon2id tag", async () => {
    const tag = await kdbxArgon2(
      password,
      salt,
      1024,
      3,
      32,
      2,
      CryptoEngine.Argon2TypeArgon2id,
      0x13,
    );
    expect(hex(tag)).toBe(
      "2af4ccbc771a1be87f7ae307f2dc217397b0adf0f1f21b42a831733b0d3405ee",
    );
  });

  test("refuses Argon2 1.0", async () => {
    const error = await kdbxArgon2(
      password,
      salt,
      1024,
      3,
      32,
      2,
      CryptoEngine.Argon2TypeArgon2d,
      0x10,
    ).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toEqual(new Error("Unsupported Argon2 version 0x10."));
  });
});
