import { expect, test } from "bun:test";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_PAYLOAD_FORMAT,
  type BackupPayload,
  backupFileRequiresPassword,
  decodeBackupFile,
  encodeBackupFile,
} from "./localBackupFormat";

const payload: BackupPayload = {
  blobs: [],
  createdAt: "2026-09-05T12:00:00.000Z",
  database: { indexes: [], tables: [] },
  format: BACKUP_PAYLOAD_FORMAT,
  missingBlobStorageKeys: [],
  source: { databaseId: "source", signingFingerprint: null, userAgent: null },
  summary: {
    blobBytes: 0,
    blobCount: 0,
    missingBlobCount: 0,
    rowCount: 0,
    tableCount: 0,
  },
  version: BACKUP_FORMAT_VERSION,
};

test.each([
  undefined,
  "",
])("passwordless backups contain a validated readable payload (password: %s)", async (password) => {
  const text = await encodeBackupFile({ password, payload });
  expect(JSON.parse(text)).toEqual(payload);
  expect(backupFileRequiresPassword(text)).toBe(false);
  await expect(decodeBackupFile({ text })).resolves.toEqual(payload);
  await expect(decodeBackupFile({ password: "", text })).resolves.toEqual(
    payload,
  );
  await expect(
    decodeBackupFile({ password: "unused-password", text }),
  ).resolves.toEqual(payload);
});

test("encrypted backups require a password and reject incorrect passwords", async () => {
  const text = await encodeBackupFile({ password: "test-password", payload });
  expect(backupFileRequiresPassword(text)).toBe(true);
  expect(text).not.toContain(payload.createdAt);
  await expect(decodeBackupFile({ text })).rejects.toThrow(
    "Enter the restore password.",
  );
  await expect(decodeBackupFile({ password: "", text })).rejects.toThrow(
    "Enter the restore password.",
  );
  await expect(
    decodeBackupFile({ password: "wrong-password", text }),
  ).rejects.toThrow("Backup password is incorrect");
  await expect(
    decodeBackupFile({ password: "test-password", text }),
  ).resolves.toEqual(payload);
});

test("rejects unsupported encrypted file versions and unsafe KDF iterations", async () => {
  const text = await encodeBackupFile({ password: "test-password", payload });
  const envelope = JSON.parse(text) as {
    version: number;
    kdf: { iterations: number };
  };
  envelope.version = BACKUP_FORMAT_VERSION - 1;
  await expect(
    decodeBackupFile({
      password: "test-password",
      text: JSON.stringify(envelope),
    }),
  ).rejects.toThrow("Backup file version is not supported.");
  envelope.version = BACKUP_FORMAT_VERSION;
  envelope.kdf.iterations = 1_000_001;
  await expect(
    decodeBackupFile({
      password: "test-password",
      text: JSON.stringify(envelope),
    }),
  ).rejects.toThrow("Backup KDF iterations count is out of safe bounds.");
});

test.each([
  undefined,
  "test-password",
])("rejects legacy payloads in both formats (password: %s)", async (password) => {
  const text = await encodeBackupFile({
    password,
    payload: {
      ...payload,
      version: BACKUP_FORMAT_VERSION - 1,
    } as unknown as BackupPayload,
  });
  await expect(decodeBackupFile({ password, text })).rejects.toThrow(
    "Backup payload version is not supported.",
  );
});

test.each([
  ["{", "Backup file must be valid JSON."],
  ["null", "Backup file must be an object."],
  ['{"format":"unknown"}', "Backup file format is not supported."],
  [
    JSON.stringify({ ...payload, database: null }),
    "Backup database must be an object.",
  ],
  [
    JSON.stringify({ ...payload, blobs: [{}] }),
    "Backup blob 1 size must be a finite number.",
  ],
  [
    JSON.stringify({
      ...payload,
      database: {
        indexes: [],
        tables: [{ columns: ["id"], rows: [{ id: {} }] }],
      },
    }),
    "Backup table 1 row 1 column id must be a string, number, or null.",
  ],
])("rejects malformed backup %s", async (text, message) => {
  expect(() => backupFileRequiresPassword(text)).toThrow(message);
  await expect(decodeBackupFile({ text })).rejects.toThrow(message);
});
