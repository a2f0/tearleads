import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { createKeepassTestDatabase } from "@tearleads/keepass/test-database";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { loadFolderTree } from "./folderTree";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { withSession } from "./session";

const MASTER_PASSWORD = "correct horse";

const database = () =>
  createKeepassTestDatabase({
    name: "Family Vault",
    password: MASTER_PASSWORD,
    root: {
      name: "Root",
      entries: [
        {
          fields: {
            Title: "Bank",
            URL: "https://bank.example.com",
            UserName: "root",
          },
          protectedFields: { Password: "rootpw" },
        },
      ],
      groups: [
        {
          name: "Email",
          groups: [
            {
              name: "Work",
              entries: [
                {
                  fields: {
                    "Account number": "12-34",
                    Notes: "line one\nline two",
                    Title: "Mail",
                    UserName: "alice",
                  },
                  protectedFields: {
                    PIN: "4321",
                    Password: "s3cret-Ω",
                    otp: "otpauth://totp/Mail:alice?secret=JBSWY3DPEHPK3PXP",
                  },
                  tags: ["work"],
                },
              ],
            },
          ],
        },
        { name: "", entries: [{ fields: { Title: "Loose" } }] },
      ],
    },
  });

interface RestoredPasscode {
  readonly folder: string;
  readonly kind: string;
  readonly rows: ReadonlyArray<Record<string, string>>;
  readonly fields: Readonly<Record<string, string>>;
  readonly title: string;
}

function folderPath(
  node: ContainerNode,
  byId: ReadonlyMap<string, ContainerNode>,
  rootId: string,
): string {
  const names: string[] = [];
  for (let at: ContainerNode | undefined = node; at && at.id !== rootId; ) {
    names.unshift(at.name);
    at = at.parentId === null ? undefined : byId.get(at.parentId);
  }
  return names.join("/");
}

/** Reads every folder and passcode under the root from a fresh session. */
async function readFromFreshDevice(
  apiBaseUrl: string,
  recoveryKey: string,
  rootId: string,
) {
  return withSession(
    {
      apiBaseUrl,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      recoveryKey,
    },
    async (session) => {
      const { sdk } = session;
      const { nodes } = await loadFolderTree(session);
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const folders = nodes
        .filter((node) => node.id !== rootId && !node.systemSlot)
        .map((node) => ({ node, path: folderPath(node, byId, rootId) }));
      const passcodes: RestoredPasscode[] = [];
      for (const { node, path } of folders) {
        const rows = new Map<string, DocumentSummary>();
        for (;;) {
          const batch = await sdk.containerContents.discoverContainerDocuments(
            node.id,
          );
          if (!batch) throw new Error("Could not discover restored passcodes");
          if (!batch.length) break;
          for (const row of batch) rows.set(row.id, row);
        }
        for (const row of rows.values()) {
          const store = sdk.containerContents.documentLinks().openDocument({
            containerId: node.id,
            documentId: row.documentId,
            localId: row.id,
          });
          expect(await store.ensureInitialized()).toBe(true);
          expect(await store.requestRemoteSyncAndWait()).toBe(true);
          const snapshot = store.getSnapshot();
          passcodes.push({
            fields: snapshot.structuredFields,
            folder: path,
            kind: snapshot.documentKind,
            rows: snapshot.rows.map((documentRow) => documentRow.fields),
            title: snapshot.title,
          });
        }
      }
      session.assertNoFailures();
      return {
        folders: folders.map(({ path }) => path).sort(),
        passcodes: passcodes.sort((left, right) =>
          left.title < right.title ? -1 : 1,
        ),
      };
    },
  );
}

test("restore-keepass restores groups as folders and entries as passcodes", async () => {
  await initializeApiDatabase();
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      requests++;
      return routeApp.fetch(request);
    },
  });
  const directory = await mkdtemp(join(tmpdir(), "tearleads-keepass-"));
  try {
    const apiBaseUrl = server.url.origin;
    const { rootContainerId, seedPhrase } =
      await registerCliTestAccount(apiBaseUrl);
    const file = join(directory, "vault.kdbx");
    await writeFile(file, await database());

    // A wrong master password stops before any request.
    const refused = testContext({ apiBaseUrl, password: "wrong" });
    await refused.keyStore.save("staging", seedPhrase);
    requests = 0;
    expect(
      await runCli(
        ["restore-keepass", file, "--env", "staging"],
        refused.context,
      ),
    ).toBe(1);
    expect(refused.output.stderr).toEqual([
      "The master password or key file is wrong.",
    ]);
    expect(requests).toBe(0);

    const { context, keyStore, output } = testContext({
      apiBaseUrl,
      password: MASTER_PASSWORD,
    });
    await keyStore.save("staging", seedPhrase);
    for (let run = 0; run < 2; run++) {
      expect(
        await runCli(["restore-keepass", file, "--env", "staging"], context),
      ).toBe(0);
    }
    expect(output.stderr).toEqual([]);
    expect(output.stdout).toEqual([
      expect.stringMatching(
        /^Restored 3 passcodes in 4 folders to "Family Vault" \([^)]+\) on staging\.$/u,
      ),
      "Left out: 1 entry in the recycle bin.",
      expect.stringMatching(
        /^Restored 3 passcodes in 4 folders to "Family Vault \(2\)" \([^)]+\) on staging\.$/u,
      ),
      "Left out: 1 entry in the recycle bin.",
    ]);

    const restored = await readFromFreshDevice(
      apiBaseUrl,
      seedPhrase,
      rootContainerId,
    );
    expect(restored.folders).toEqual(
      ["Family Vault", "Family Vault (2)"]
        .flatMap((name) => [
          name,
          `${name}/Email`,
          `${name}/Email/Work`,
          `${name}/Untitled group`,
        ])
        .sort(),
    );
    const mail = restored.passcodes.filter(({ title }) => title === "Mail");
    expect(mail.map(({ folder }) => folder).sort()).toEqual([
      "Family Vault (2)/Email/Work",
      "Family Vault/Email/Work",
    ]);
    for (const passcode of mail) {
      expect(passcode.kind).toBe("passcode");
      expect(passcode.fields).toMatchObject({
        notes: "line one\nline two",
        otp: "otpauth://totp/Mail:alice?secret=JBSWY3DPEHPK3PXP",
        password: "s3cret-Ω",
        sourceId: expect.stringMatching(/^keepass:/u),
        tags: "work",
        title: "Mail",
        username: "alice",
      });
      expect(passcode.rows).toEqual([
        expect.objectContaining({ name: "Account number", value: "12-34" }),
        expect.objectContaining({
          name: "PIN",
          protected: "true",
          value: "4321",
        }),
      ]);
    }
    expect(
      restored.passcodes
        .filter(({ title }) => title !== "Mail")
        .map(({ folder, title }) => `${folder}: ${title}`)
        .sort(),
    ).toEqual(
      [
        "Family Vault (2): Bank",
        "Family Vault (2)/Untitled group: Loose",
        "Family Vault: Bank",
        "Family Vault/Untitled group: Loose",
      ].sort(),
    );
  } finally {
    await server.stop(true);
    await rm(directory, { force: true, recursive: true });
  }
}, 120_000);
