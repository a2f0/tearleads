import { describe, expect, test } from "bun:test";
import type { KeepassEntry } from "@tearleads/keepass";
import { passcodeFromEntry } from "./passcodeFromEntry";

const entry: KeepassEntry = {
  attachments: [{ byteLength: 25, name: "recovery.txt" }],
  createdAt: "2025-02-01T08:00:00.000Z",
  customFields: [
    { name: "Account number", protected: false, value: "12-34" },
    { name: "PIN", protected: true, value: "4321" },
    { name: "otp", protected: true, value: "otpauth://totp/Mail:alice" },
  ],
  // 23:30 on 31 January here; west of UTC, that instant's UTC date is 1 February.
  expiresAt: new Date(2027, 0, 31, 23, 30).toISOString(),
  historyCount: 1,
  id: "bWFpbGVudHJ5dXVpZDAwMQ==",
  modifiedAt: "2026-06-01T12:00:00.000Z",
  notes: "line one\nline two",
  password: "s3cret",
  tags: ["email", "work"],
  title: "Mail",
  url: "https://mail.example.com",
  username: "alice@example.com",
};

describe("passcodeFromEntry", () => {
  test("maps the standard fields, TOTP, tags, expiry, and provenance", () => {
    expect(passcodeFromEntry(entry).fields).toEqual({
      expirationDate: "2027-01-31",
      notes: "line one\nline two",
      otp: "otpauth://totp/Mail:alice",
      password: "s3cret",
      sourceCreatedAt: "2025-02-01T08:00:00.000Z",
      sourceId: "keepass:bWFpbGVudHJ5dXVpZDAwMQ==",
      sourceModifiedAt: "2026-06-01T12:00:00.000Z",
      tags: "email, work",
      title: "Mail",
      url: "https://mail.example.com",
      username: "alice@example.com",
    });
  });

  test("keeps every other custom field as an attribute row", () => {
    expect(passcodeFromEntry(entry).rows).toEqual([
      { name: "Account number", value: "12-34" },
      { name: "PIN", protected: "true", value: "4321" },
    ]);
  });

  test("reads an expiry past year 9999 as none", () => {
    const farFuture = passcodeFromEntry({
      ...entry,
      // Mid-year, so the year is 10000 in every time zone.
      expiresAt: "+010000-06-01T00:00:00.000Z",
    });
    expect(farFuture.fields.expirationDate).toBeUndefined();
  });

  test("leaves blank fields unwritten", () => {
    const sparse = passcodeFromEntry({
      ...entry,
      createdAt: null,
      customFields: [],
      expiresAt: null,
      modifiedAt: null,
      notes: "",
      tags: [],
      url: "",
      username: "",
    });
    expect(sparse).toEqual({
      fields: {
        password: "s3cret",
        sourceId: "keepass:bWFpbGVudHJ5dXVpZDAwMQ==",
        title: "Mail",
      },
      rows: [],
    });
  });
});
