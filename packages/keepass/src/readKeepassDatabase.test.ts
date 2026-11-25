import { describe, expect, test } from "bun:test";
import {
  Consts,
  KdbxCredentials,
  Kdbx as KdbxDatabase,
  ProtectedValue,
} from "kdbxweb";
import { installArgon2 } from "./argon2";
import {
  KEEPASSXC_FIXTURE_BASE64,
  KEEPASSXC_FIXTURE_PASSWORD,
} from "./keepassxcFixture.testUtils";
import {
  KEEPASS_MAX_FILE_BYTES,
  KeepassReadError,
  readKeepassDatabase,
} from "./readKeepassDatabase";

const keepassxcFixture = Uint8Array.from(
  Buffer.from(KEEPASSXC_FIXTURE_BASE64, "base64"),
);

async function expectReadError(
  read: Promise<unknown>,
  code: KeepassReadError["code"],
) {
  const error = await read.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof KeepassReadError)) {
    throw new Error(`Expected a KeepassReadError, got ${String(error)}`);
  }
  expect(error.code).toBe(code);
  return error;
}

describe("readKeepassDatabase with a KeePassXC database", () => {
  test("reads groups, entries, and every entry field", async () => {
    const database = await readKeepassDatabase(keepassxcFixture, {
      password: KEEPASSXC_FIXTURE_PASSWORD,
    });

    expect(database.name).toBe("Family Vault");
    expect(database.skipped).toEqual({ recycledEntries: 2, recycledGroups: 2 });
    expect(database.root.name).toBe("Family Vault");
    expect(database.root.entries).toEqual([
      {
        attachments: [],
        createdAt: "2024-01-15T09:30:00.000Z",
        customFields: [],
        expiresAt: null,
        historyCount: 0,
        id: "YmFua2VudHJ5dXVpZDAwMQ==",
        modifiedAt: "2025-03-02T10:00:00.000Z",
        notes: "",
        password: "rootpw",
        tags: [],
        title: "Bank",
        url: "https://bank.example.com/login",
        username: "root",
      },
    ]);
    // The recycle bin is a sibling of Email and is left out.
    expect(database.root.groups.map((group) => group.name)).toEqual(["Email"]);
    const [email] = database.root.groups;
    expect(email?.entries).toEqual([]);
    expect(email?.groups.map((group) => group.name)).toEqual(["Work"]);
    expect(email?.groups[0]?.entries).toEqual([
      {
        attachments: [{ byteLength: 25, name: "recovery.txt" }],
        createdAt: "2025-02-01T08:00:00.000Z",
        customFields: [
          { name: "Account number", protected: false, value: "12-34" },
          { name: "PIN", protected: true, value: "4321" },
          {
            name: "otp",
            protected: true,
            value:
              "otpauth://totp/Mail:alice?secret=JBSWY3DPEHPK3PXP&issuer=Mail",
          },
        ],
        expiresAt: "2027-01-31T00:00:00.000Z",
        historyCount: 1,
        id: "bWFpbGVudHJ5dXVpZDAwMQ==",
        modifiedAt: "2026-06-01T12:00:00.000Z",
        notes: "line one\nline two",
        password: "s3cret-Ω",
        tags: ["email", "work"],
        title: "Mail",
        url: "https://mail.example.com",
        username: "alice@example.com",
      },
    ]);
  });

  test("rejects a wrong master password", async () => {
    const error = await expectReadError(
      readKeepassDatabase(keepassxcFixture, { password: "not it" }),
      "wrong-key",
    );
    expect(error.message).toBe("The master password or key file is wrong.");
  });
});

async function createKdbx4(params: {
  kdf: string;
  keyFile?: Uint8Array;
  password?: string;
}): Promise<Uint8Array> {
  installArgon2();
  const credentials = new KdbxCredentials(
    params.password === undefined
      ? null
      : ProtectedValue.fromString(params.password),
    params.keyFile ?? null,
  );
  await credentials.ready;
  const database = KdbxDatabase.create(credentials, "Generated");
  database.setVersion(4);
  database.setKdf(params.kdf);
  const entry = database.createEntry(database.getDefaultGroup());
  entry.fields.set("Title", "Router");
  entry.fields.set("Password", ProtectedValue.fromString("hunter2"));
  return new Uint8Array(await database.save());
}

describe("readKeepassDatabase with KDBX 4", () => {
  for (const [label, kdf] of [
    ["Argon2d", Consts.KdfId.Argon2d],
    ["Argon2id", Consts.KdfId.Argon2id],
  ] as const) {
    test(`reads a password-protected ${label} database`, async () => {
      const bytes = await createKdbx4({ kdf, password: "pw" });
      const database = await readKeepassDatabase(bytes, { password: "pw" });
      expect(database.name).toBe("Generated");
      expect(
        database.root.entries.map(({ password, title }) => ({
          password,
          title,
        })),
      ).toEqual([{ password: "hunter2", title: "Router" }]);
    });
  }

  test("opens a key-file-only database and requires its key file", async () => {
    const keyFile = await KdbxCredentials.createRandomKeyFile(2);
    const bytes = await createKdbx4({ kdf: Consts.KdfId.Argon2d, keyFile });

    const database = await readKeepassDatabase(bytes, { keyFile });
    expect(database.root.entries[0]?.password).toBe("hunter2");
    await expectReadError(
      readKeepassDatabase(bytes, { keyFile, password: "extra" }),
      "wrong-key",
    );
  });

  test("tries a blank password as none, then as an empty password", async () => {
    const keyFile = await KdbxCredentials.createRandomKeyFile(2);
    const kdf = Consts.KdfId.Argon2d;
    for (const bytes of [
      await createKdbx4({ kdf, keyFile }),
      await createKdbx4({ kdf, keyFile, password: "" }),
    ]) {
      const database = await readKeepassDatabase(bytes, {
        keyFile,
        password: "",
      });
      expect(database.root.entries).toHaveLength(1);
    }
    const emptyOnly = await createKdbx4({ kdf, password: "" });
    const database = await readKeepassDatabase(emptyOnly, { password: "" });
    expect(database.root.entries).toHaveLength(1);
    await expectReadError(
      readKeepassDatabase(emptyOnly, { password: "pw" }),
      "wrong-key",
    );
  });
});

describe("readKeepassDatabase refusals", () => {
  test("requires a password or key file", async () => {
    await expectReadError(
      readKeepassDatabase(keepassxcFixture, {}),
      "no-credentials",
    );
    await expectReadError(
      readKeepassDatabase(keepassxcFixture, { password: "" }),
      "wrong-key",
    );
  });

  test("rejects a file that is not a KeePass 2 database", async () => {
    await expectReadError(
      readKeepassDatabase(new TextEncoder().encode("title,password\n"), {
        password: "pw",
      }),
      "not-kdbx",
    );
  });

  test("reports a damaged or cut-off file as corrupt", async () => {
    const damaged = keepassxcFixture.slice();
    const at = Math.floor(damaged.length * 0.6);
    damaged[at] = (damaged[at] ?? 0) ^ 0xff;
    const credentials = { password: KEEPASSXC_FIXTURE_PASSWORD };
    const error = await expectReadError(
      readKeepassDatabase(damaged, credentials),
      "corrupt",
    );
    expect(error.message).toBe(
      "The database could not be read: invalid hash block.",
    );
    await expectReadError(
      readKeepassDatabase(keepassxcFixture.slice(0, 100), credentials),
      "corrupt",
    );
  });

  test("names an unsupported cipher or version", async () => {
    const credentials = { password: KEEPASSXC_FIXTURE_PASSWORD };
    // The header's cipher id, AES-256, swapped for Twofish.
    const twofish = keepassxcFixture.slice();
    const aes = Buffer.from("31c1f2e6bf714350be5805216afc5aff", "hex");
    const at = Buffer.from(twofish).indexOf(aes);
    expect(at).toBeGreaterThan(0);
    twofish.set(Buffer.from("ad68f29f576f4bb9a36ad47af965346c", "hex"), at);
    const error = await expectReadError(
      readKeepassDatabase(twofish, credentials),
      "unsupported",
    );
    expect(error.message).toContain("(unsupported cipher)");
    expect(error.message).toContain("Twofish is not");
    // KDBX major version 9 (bytes 10-11 of the signature block).
    const future = keepassxcFixture.slice();
    future[10] = 9;
    await expectReadError(
      readKeepassDatabase(future, credentials),
      "unsupported",
    );
  });

  test("rejects a file over the size limit before reading it", async () => {
    await expectReadError(
      readKeepassDatabase(new Uint8Array(KEEPASS_MAX_FILE_BYTES + 1), {
        password: "pw",
      }),
      "too-large",
    );
  });
});
