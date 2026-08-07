import { expect, test } from "bun:test";
import { isSessionData } from "./session";

const validSession = {
  createdAt: 0,
  fingerprint: "b".repeat(64),
  id: "a".repeat(64),
  ipAddresses: ["127.0.0.1"],
  lastActiveAt: Number.MAX_SAFE_INTEGER,
  lastActiveIp: null,
  userId: "12345678-1234-4123-8123-123456789abc",
};

test("accepts complete plain session data and ignores extra fields", () => {
  expect(isSessionData(validSession)).toBe(true);
  expect(isSessionData({ ...validSession, extra: "ignored" })).toBe(true);
  expect(isSessionData({ ...validSession, lastActiveIp: "203.0.113.1" })).toBe(
    true,
  );
});

test("rejects malformed session fields and non-plain objects", () => {
  const invalidValues: unknown[] = [
    null,
    [],
    Object.assign(new (class Session {})(), validSession),
    { ...validSession, id: "A".repeat(64) },
    { ...validSession, userId: "12345678-1234-1123-8123-123456789abc" },
    { ...validSession, fingerprint: "B".repeat(64) },
    { ...validSession, createdAt: -1 },
    { ...validSession, createdAt: 0.5 },
    { ...validSession, lastActiveAt: Number.MAX_SAFE_INTEGER + 1 },
    { ...validSession, ipAddresses: [""] },
    { ...validSession, lastActiveIp: "" },
  ];

  for (const value of invalidValues) {
    expect(isSessionData(value)).toBe(false);
  }
});
