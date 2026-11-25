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

  test("treats a blank password as none", async () => {
    const keyFile = await KdbxCredentials.createRandomKeyFile(2);
    const bytes = await createKdbx4({ kdf: Consts.KdfId.Argon2d, keyFile });
    const database = await readKeepassDatabase(bytes, {
      keyFile,
      password: "",
    });
    expect(database.root.entries).toHaveLength(1);
  });
});

describe("readKeepassDatabase refusals", () => {
  test("requires a password or key file", async () => {
    await expectReadError(
      readKeepassDatabase(keepassxcFixture, { password: "" }),
      "no-credentials",
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

  test("rejects a file over the size limit before reading it", async () => {
    await expectReadError(
      readKeepassDatabase(new Uint8Array(KEEPASS_MAX_FILE_BYTES + 1), {
        password: "pw",
      }),
      "too-large",
    );
  });
});
