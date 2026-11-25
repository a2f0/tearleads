import { beforeAll, expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { LEGAL_TERMS_VERSION } from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  appendNoteAddition,
  continuityFolders,
  continuityGroups,
  loadContinuityAssets,
} from "app/continuity";
import { loadFolderTree } from "./folderTree";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { resolveSeedAccount } from "./seedAccount";
import { createSeedRun } from "./seedDocument";
import { seedFolders } from "./seedFolders";
import { memberRecoveryKey, seedRoster } from "./seedRoster";
import { type CliSession, withSession } from "./session";

let apiBaseUrl = "";
// Sign-ins during the folder step: each is a member signing in to add a line.
let countSignIns = false;
let signIns = 0;

beforeAll(async () => {
  await initializeApiDatabase();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      if (countSignIns && new URL(request.url).pathname === "/auth/verify")
        signIns += 1;
      return routeApp.fetch(request);
    },
  });
  apiBaseUrl = server.url.origin;
});

function asOwner<T>(
  recoveryKey: string,
  work: (session: CliSession) => Promise<T>,
) {
  return withSession(
    {
      apiBaseUrl,
      recoveryKey,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      automaticSessionRenewal: false,
    },
    work,
  );
}

// The roster and folder steps of `seed --roster`, without the dataset's
// documents and their uploads, which the seed tests cover.
function seedFamily(recoveryKey: string) {
  return asOwner(recoveryKey, async (session) => {
    const { spec, datasetSha256, readAttachment } =
      await loadContinuityAssets();
    const account = await resolveSeedAccount(session, undefined);
    const { signingPrivateKey } = account;
    await seedRoster(session, {
      agreeToLegalTerms: async () => LEGAL_TERMS_VERSION,
      apiBaseUrl,
      groups: continuityGroups(spec),
      signingPrivateKey,
    });
    const run = createSeedRun(session, {
      rootId: account.rootId,
      signingPrivateKey,
      datasetSha256,
      readAttachment,
      folders: new Set(account.folders.map(({ id }) => id)),
    });
    signIns = 0;
    countSignIns = true;
    try {
      const seeded = await seedFolders(run, continuityFolders(spec), {
        apiBaseUrl,
        memberRecoveryKey: (contactId) =>
          memberRecoveryKey(signingPrivateKey, contactId),
      });
      return { ...seeded, signIns };
    } finally {
      countSignIns = false;
    }
  });
}

test("seedFolders shares each folder with its groups and members add their lines", async () => {
  const { spec } = await loadContinuityAssets();
  const [family] = continuityFolders(spec);
  const [note] = family?.notes ?? [];
  if (!family || !note || note.additions.length === 0) {
    throw new Error("The pinned dataset has no shared folder note.");
  }
  const expectedText = note.additions.reduce(
    (text, { text: line }) => appendNoteAddition(text, line) ?? text,
    note.document.text ?? "",
  );
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);

  expect(await seedFamily(seedPhrase)).toEqual({
    folders: 1,
    notes: 1,
    grants: family.grants.length,
    additions: note.additions.length,
    signIns: note.additions.length,
  });
  // A rerun, as from a fresh device, reuses the folder, keeps the grant, and
  // sees every line already in the note, so no member signs in.
  expect(await seedFamily(seedPhrase)).toEqual({
    folders: 1,
    notes: 1,
    grants: 0,
    additions: 0,
    signIns: 0,
  });

  await asOwner(seedPhrase, async (session) => {
    const { sdk, userId } = session;
    const { nodes } = await loadFolderTree(session);
    const rootId = sdk.runtime.input().auth.rootContainerId;
    const folders = nodes.filter(
      (node) => node.parentId === rootId && node.name === family.name,
    );
    expect(folders).toHaveLength(1);
    const folderId = folders[0]?.id ?? "";

    const state = await sdk.organizations.loadDirectoryAndGroups();
    const group = state?.groups.find(({ name }) => name === family.name);
    expect(group).toBeDefined();
    const containers = await sdk.organizations.loadGroupContainers(
      group?.groupId ?? "",
    );
    expect(
      containers?.containers
        .filter(({ containerId }) => containerId === folderId)
        .map(({ accessLevel }) => accessLevel),
    ).toEqual(["write"]);

    const rows =
      await sdk.containerContents.discoverContainerDocuments(folderId);
    expect(rows).toHaveLength(1);
    const [row] = rows ?? [];
    if (!row?.documentId) throw new Error("Missing the folder note.");
    const store = sdk.containerContents.documentLinks().openDocument({
      containerId: folderId,
      localId: row.id,
      documentId: row.documentId,
    });
    expect(await store.ensureInitialized()).toBe(true);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(store.getSnapshot().text).toBe(expectedText);

    // The owner and each member wrote their own part of the note.
    const attribution = await sdk.containerContents.loadDocumentEditAttribution(
      row.documentId,
    );
    const writers = new Set(
      attribution?.segments.map(({ writerUserId }) => writerUserId),
    );
    expect(writers.has(userId)).toBe(true);
    expect(writers.size).toBe(1 + note.additions.length);
  });
}, 300_000);
