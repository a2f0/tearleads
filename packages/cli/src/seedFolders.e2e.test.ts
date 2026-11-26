import { beforeAll, expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import {
  getOrCreateDomainSyncCoordinator,
  LEGAL_TERMS_VERSION,
  type Tearleads,
} from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  appendNoteAddition,
  continuityDocuments,
  continuityFolders,
  continuityGroups,
  loadContinuityAssets,
} from "app/continuity";
import { loadFolderTree } from "./folderTree";

import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { resolveSeedAccount } from "./seedAccount";
import { createSeedRun, seedContinuityDocument } from "./seedDocument";
import { seedFolders } from "./seedFolders";
import { memberRecoveryKey, seedRoster } from "./seedRoster";
import { type CliSession, withSession } from "./session";

type FolderNodes = Awaited<ReturnType<typeof loadFolderTree>>["nodes"];

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
// documents and their uploads, which the seed tests cover. Without
// `withRoster` the folder step runs as a plain `seed` does.
function seedFamily(recoveryKey: string, withRoster = true) {
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
      const roster = {
        apiBaseUrl,
        memberRecoveryKey: (contactId: string) =>
          memberRecoveryKey(signingPrivateKey, contactId),
      };
      const seeded = await seedFolders(
        run,
        continuityFolders(spec),
        withRoster ? roster : null,
      );
      return { ...seeded, signIns };
    } finally {
      countSignIns = false;
    }
  });
}

async function familyFixture() {
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
  return { family, note, expectedText };
}

function rootFolder(session: CliSession, nodes: FolderNodes, name: string) {
  const rootId = session.sdk.runtime.input().auth.rootContainerId;
  const folders = nodes.filter(
    (node) => node.parentId === rootId && node.name === name,
  );
  expect(folders).toHaveLength(1);
  return folders[0]?.id ?? "";
}

function syncIdle(sdk: Tearleads) {
  return getOrCreateDomainSyncCoordinator(
    sdk.runtime.input().state.domainScope,
  ).waitForIdle({ timeoutMs: 30_000 });
}

/** Moves a folder's note into another folder, as its owner would. */
async function moveFolderNote(
  sdk: Tearleads,
  row: Awaited<ReturnType<typeof readFolderNote>>["row"],
  toId: string,
) {
  const moved = await sdk.containerContents
    .documentLinks()
    .moveDocumentToContainer({
      note: row,
      targetContainerId: toId,
      replaceLinkedContainers: true,
      expandNode: () => {},
      mergeDocumentSummary: () => {},
      setLinkedContainerIdsForDocument: () => {},
    });
  expect(moved.note?.containerId).toBe(toId);
  expect(await syncIdle(sdk)).toBe(true);
}

/** The access levels the named group holds on the folder. */
async function groupAccess(sdk: Tearleads, name: string, folderId: string) {
  const state = await sdk.organizations.loadDirectoryAndGroups();
  const group = state?.groups.find((candidate) => candidate.name === name);
  expect(group).toBeDefined();
  const containers = await sdk.organizations.loadGroupContainers(
    group?.groupId ?? "",
  );
  return containers?.containers
    .filter(({ containerId }) => containerId === folderId)
    .map(({ accessLevel }) => accessLevel);
}

/** The folder's one note: its summary, synced text, and distinct writers. */
async function readFolderNote(sdk: Tearleads, folderId: string) {
  const rows = await sdk.containerContents.discoverContainerDocuments(folderId);
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
  const attribution = await sdk.containerContents.loadDocumentEditAttribution(
    row.documentId,
  );
  return {
    row,
    text: store.getSnapshot().text,
    writers: new Set(
      attribution?.segments.map(({ writerUserId }) => writerUserId),
    ),
  };
}

test("seedFolders shares each folder with its groups and members add their lines", async () => {
  const { family, note, expectedText } = await familyFixture();
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);

  expect(await seedFamily(seedPhrase)).toEqual({
    folders: 1,
    notes: 1,
    grants: family.grants.length,
    additions: note.additions.length,
    moved: 0,
    left: 0,
    signIns: note.additions.length,
  });
  // A rerun, as from a fresh device, reuses the folder, keeps the grant, and
  // sees every line already in the note, so no member signs in.
  expect(await seedFamily(seedPhrase)).toEqual({
    folders: 1,
    notes: 1,
    grants: 0,
    additions: 0,
    moved: 0,
    left: 0,
    signIns: 0,
  });

  await asOwner(seedPhrase, async (session) => {
    const { sdk, userId } = session;
    const { nodes } = await loadFolderTree(session);
    const folderId = rootFolder(session, nodes, family.name);
    expect(await groupAccess(sdk, family.name, folderId)).toEqual(["write"]);
    const { text, writers } = await readFolderNote(sdk, folderId);
    expect(text).toBe(expectedText);
    // The owner and each member wrote their own part of the note.
    expect(writers.has(userId)).toBe(true);
    expect(writers.size).toBe(1 + note.additions.length);
  });
}, 300_000);

test("a note the owner moved out of its folder stays unshared, without lines", async () => {
  const { family, note } = await familyFixture();
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  // A plain seed writes the note in the folder, with no grant and no lines.
  expect(await seedFamily(seedPhrase, false)).toMatchObject({
    notes: 1,
    grants: 0,
    additions: 0,
  });

  const elsewhereId = await asOwner(seedPhrase, async (session) => {
    const { sdk } = session;
    const { nodes } = await loadFolderTree(session);
    const rootId = sdk.runtime.input().auth.rootContainerId;
    if (!rootId) throw new Error("Missing the personal root.");
    const elsewhere = await sdk.containerContents
      .openTree()
      .createChild(rootId, "Elsewhere");
    if (!elsewhere) throw new Error("Could not create the target folder.");
    expect(await syncIdle(sdk)).toBe(true);
    const { row } = await readFolderNote(
      sdk,
      rootFolder(session, nodes, family.name),
    );
    await moveFolderNote(sdk, row, elsewhere.id);
    return elsewhere.id;
  });

  // The seed shares its own folder but keeps the note where the owner put
  // it, so no member signs in to add a line to the moved note.
  expect(await seedFamily(seedPhrase)).toEqual({
    folders: 1,
    notes: 1,
    grants: family.grants.length,
    additions: 0,
    moved: 1,
    left: 0,
    signIns: 0,
  });
  await asOwner(seedPhrase, async (session) => {
    const { sdk } = session;
    await loadFolderTree(session);
    expect(await groupAccess(sdk, family.name, elsewhereId)).toEqual([]);
    const { text, writers } = await readFolderNote(sdk, elsewhereId);
    expect(text).toBe(note.document.text ?? "");
    expect(writers).toEqual(new Set([session.userId]));
  });
}, 300_000);

test("a folder of the user's own by the dataset's name is left alone", async () => {
  const { family, note, expectedText } = await familyFixture();
  const { spec, datasetSha256, readAttachment } = await loadContinuityAssets();
  const other = continuityDocuments(spec).find(
    (document) => document.kind === "note",
  );
  if (!other) throw new Error("The pinned dataset has no root note.");
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  // The user's own folder by that name, holding a note of theirs.
  const mineId = await asOwner(seedPhrase, async (session) => {
    const { sdk } = session;
    const account = await resolveSeedAccount(session, undefined);
    const mine = await sdk.containerContents
      .openTree()
      .createChild(account.rootId, family.name);
    if (!mine) throw new Error("Could not create the user's folder.");
    expect(await syncIdle(sdk)).toBe(true);
    const run = createSeedRun(session, {
      rootId: account.rootId,
      signingPrivateKey: account.signingPrivateKey,
      datasetSha256,
      readAttachment,
      folders: new Set([mine.id]),
    });
    expect(await seedContinuityDocument(run, other, mine.id)).not.toBe(
      "purged",
    );
    return mine.id;
  });

  // The seed makes its own folder, numbered past the user's, and a rerun
  // finds it again through its note.
  expect(await seedFamily(seedPhrase)).toEqual({
    folders: 1,
    notes: 1,
    grants: family.grants.length,
    additions: note.additions.length,
    moved: 0,
    left: 0,
    signIns: note.additions.length,
  });
  expect(await seedFamily(seedPhrase)).toEqual({
    folders: 1,
    notes: 1,
    grants: 0,
    additions: 0,
    moved: 0,
    left: 0,
    signIns: 0,
  });
  await asOwner(seedPhrase, async (session) => {
    const { sdk } = session;
    const { nodes } = await loadFolderTree(session);
    expect(rootFolder(session, nodes, family.name)).toBe(mineId);
    expect(await groupAccess(sdk, family.name, mineId)).toEqual([]);
    const seededId = rootFolder(session, nodes, `${family.name} (2)`);
    expect(await groupAccess(sdk, family.name, seededId)).toEqual(["write"]);
    const { row, text } = await readFolderNote(sdk, seededId);
    expect(text).toBe(expectedText);
    // The owner moves the seeded note into their own folder of that name.
    await moveFolderNote(sdk, row, mineId);
  });
  // The seed knows its folder by id, not by name or by where its note is, so
  // the user's folder stays unshared.
  expect(await seedFamily(seedPhrase)).toMatchObject({
    folders: 1,
    grants: 0,
    additions: 0,
    signIns: 0,
  });
  await asOwner(seedPhrase, async (session) => {
    await loadFolderTree(session);
    expect(await groupAccess(session.sdk, family.name, mineId)).toEqual([]);
  });
}, 300_000);

test("a seed folder the owner moved out of the root is left whole", async () => {
  const { family, expectedText } = await familyFixture();
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  await seedFamily(seedPhrase);
  const familyId = await asOwner(seedPhrase, async (session) => {
    const { sdk } = session;
    const { nodes } = await loadFolderTree(session);
    const rootId = sdk.runtime.input().auth.rootContainerId;
    if (!rootId) throw new Error("Missing the personal root.");
    const id = rootFolder(session, nodes, family.name);
    const tree = sdk.containerContents.openTree();
    const archive = await tree.createChild(rootId, "Archive");
    if (!archive) throw new Error("Could not create the target folder.");
    expect(await syncIdle(sdk)).toBe(true);
    expect((await tree.moveContainer(id, archive.id))?.parentId).toBe(
      archive.id,
    );
    expect(await syncIdle(sdk)).toBe(true);
    return id;
  });
  // A folder in Trash is out of the root the same way.
  expect(await seedFamily(seedPhrase)).toEqual({
    folders: 0,
    notes: 0,
    grants: 0,
    additions: 0,
    moved: 0,
    left: 1,
    signIns: 0,
  });
  await asOwner(seedPhrase, async (session) => {
    const { sdk } = session;
    const { nodes } = await loadFolderTree(session);
    const rootId = sdk.runtime.input().auth.rootContainerId;
    expect(
      nodes.some(
        (node) => node.parentId === rootId && node.name === family.name,
      ),
    ).toBe(false);
    expect(await groupAccess(sdk, family.name, familyId)).toEqual(["write"]);
    expect((await readFolderNote(sdk, familyId)).text).toBe(expectedText);
  });
}, 300_000);

test("a seed folder emptied from Trash stops the folder step", async () => {
  const { family } = await familyFixture();
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  await seedFamily(seedPhrase, false);
  await asOwner(seedPhrase, async (session) => {
    const { sdk } = session;
    const { nodes } = await loadFolderTree(session);
    const rootId = sdk.runtime.input().auth.rootContainerId;
    if (!rootId) throw new Error("Missing the personal root.");
    const familyId = rootFolder(session, nodes, family.name);
    const { row } = await readFolderNote(sdk, familyId);
    await moveFolderNote(sdk, row, rootId);
    // Emptying a folder from Trash deletes it on the server, which keeps its id.
    expect(
      await sdk.containerContents.openTree().deleteContainer(familyId),
    ).toBe(true);
    expect(await syncIdle(sdk)).toBe(true);
  });
  await expect(seedFamily(seedPhrase, false)).rejects.toThrow(
    `If you emptied the seed's ${family.name} folder from Trash`,
  );
}, 300_000);
