import type { DocumentStore } from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  appendNoteAddition,
  type ContinuityFolder,
  captureContinuityScope,
  openReadyContainerTree,
} from "app/continuity";
import { waitForFoldersSynced } from "./folderSync";
import { loadFolderTree } from "./folderTree";
import {
  confirmDocumentSynced,
  type SeedRun,
  seedContinuityDocument,
  seedDocumentIds,
} from "./seedDocument";
import { type CliSession, withSession } from "./session";

// A group grant reaches a member's device as the organization read model and
// the folder's key wrap catch up, which takes a few round trips. One deadline
// bounds every attempt, its sync included.
const SETTLE_TIMEOUT_MS = 120_000;
const SETTLE_DELAY_MS = 250;

/** What folder grants and members' note additions need from `--roster`. */
export interface FolderRoster {
  readonly apiBaseUrl: string;
  /** The recovery key of the member with this Continuity contact ID. */
  readonly memberRecoveryKey: (contactId: string) => string;
}

export interface SeededFolders {
  readonly folders: number;
  readonly notes: number;
  readonly grants: number;
  readonly additions: number;
}

async function settle<T>(
  step: (deadline: AbortSignal) => Promise<T | null>,
  failure: string,
): Promise<T> {
  const deadline = AbortSignal.timeout(SETTLE_TIMEOUT_MS);
  while (!deadline.aborted) {
    const result = await step(deadline);
    if (result !== null) return result;
    await Bun.sleep(SETTLE_DELAY_MS);
  }
  throw new Error(failure);
}

/** The root's folder with this name, made and synced when it has none. */
async function ensureSeedFolder(run: SeedRun, name: string): Promise<string> {
  const { session, rootId } = run;
  const { sdk } = session;
  const { nodes } = await loadFolderTree(session);
  const existing = nodes.find(
    (node) =>
      node.parentId === rootId &&
      node.organizationId === sdk.session.organizationId &&
      !node.systemSlot &&
      node.name === name,
  );
  if (existing) return existing.id;
  const tree = await openReadyContainerTree(sdk, captureContinuityScope(sdk));
  const node = await tree.createChild(rootId, name);
  if (!node) throw new Error(`Could not create the ${name} folder.`);
  await waitForFoldersSynced(session, () => tree.getSnapshot().nodes, [
    node.id,
  ]);
  return node.id;
}

/** Grants each group its access, unless the group already holds it. */
async function grantFolder(
  session: CliSession,
  folderId: string,
  grants: ContinuityFolder["grants"],
): Promise<number> {
  const { sdk } = session;
  const state = await sdk.organizations.loadDirectoryAndGroups();
  if (!state) throw new Error("Could not read the organization's groups.");
  const tree = await openReadyContainerTree(sdk, captureContinuityScope(sdk));
  let granted = 0;
  for (const { group: name, access } of grants) {
    const groupId = state.groups.find((group) => group.name === name)?.groupId;
    if (!groupId) throw new Error(`The group ${name} does not exist.`);
    const held = async () =>
      (await sdk.organizations.loadGroupContainers(groupId))?.containers.some(
        (container) =>
          container.containerId === folderId &&
          container.accessLevel === access,
      ) ?? false;
    if (await held()) continue;
    const shared = await tree.shareWithGroup(folderId, groupId, access, {
      expectedGroupName: name,
    });
    if (!shared) throw new Error(`Could not share the folder with ${name}.`);
    granted += 1;
  }
  session.assertNoFailures();
  return granted;
}

/** The note as the member's device sees it, once their grant has reached it. */
async function openSharedNote(
  member: CliSession,
  target: { folderId: string; documentId: string },
  deadline: AbortSignal,
): Promise<DocumentStore | null> {
  const { sdk } = member;
  const { folderId, documentId } = target;
  // Discovery returns only what is new, so the note may have arrived in an
  // earlier attempt: drain it, then find the note on the device by its ID.
  let batch = await sdk.containerContents.discoverContainerDocuments(folderId);
  while (batch?.length) {
    batch = await sdk.containerContents.discoverContainerDocuments(folderId);
  }
  const localId = await sdk.documents.findLocalIdByDocumentId(documentId);
  if (!localId) return null;
  const store = sdk.containerContents
    .documentLinks()
    .openDocument({ containerId: folderId, localId, documentId });
  if (
    !(await store.ensureInitialized()) ||
    !(await store.requestRemoteSyncAndWait(deadline))
  )
    return null;
  return store;
}

/**
 * Signs in as the member and appends their line to the note, as a person
 * would on their own device. False when the note already has it.
 */
function appendAsMember(
  run: SeedRun,
  roster: FolderRoster,
  target: { folderId: string; documentId: string; key: string },
  addition: { author: string; text: string },
): Promise<boolean> {
  const { session } = run;
  const organizationId = session.sdk.session.organizationId;
  if (!organizationId) throw new Error("Missing the owner's organization.");
  return withSession(
    {
      apiBaseUrl: roster.apiBaseUrl,
      recoveryKey: roster.memberRecoveryKey(addition.author),
      tracer: session.tracer,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      automaticSessionRenewal: false,
    },
    async (member) => {
      await loadFolderTree(member, { organizationId });
      const store = await settle(
        (deadline) => openSharedNote(member, target, deadline),
        `${addition.author} could not open ${target.key}.`,
      );
      const next = appendNoteAddition(store.getSnapshot().text, addition.text);
      if (next === null) return false;
      await store.setText(next);
      await confirmDocumentSynced(member, store, target.documentId, target.key);
      return true;
    },
  );
}

/**
 * Writes the folder's notes, each with the additions its owner does not see
 * yet: lines members added in an earlier run need no member to sign in.
 */
async function seedFolderNotes(
  run: SeedRun,
  folderId: string,
  notes: ContinuityFolder["notes"],
): Promise<ContinuityFolder["notes"]> {
  const written = [];
  for (const note of notes) {
    const store = await seedContinuityDocument(run, note.document, folderId);
    if (store === "purged") continue;
    const { text } = store.getSnapshot();
    written.push({
      document: note.document,
      additions: note.additions.filter(
        (addition) => appendNoteAddition(text, addition.text) !== null,
      ),
    });
  }
  return written;
}

/** Each note's missing lines, appended by their members in order. */
async function addMemberLines(
  run: SeedRun,
  roster: FolderRoster,
  folderId: string,
  notes: ContinuityFolder["notes"],
): Promise<number> {
  let added = 0;
  for (const { document, additions } of notes) {
    const { documentId } = await seedDocumentIds(run, document.key);
    for (const addition of additions) {
      const appended = await run.session.tracer.span(
        `add ${document.key} by ${addition.author}`,
        () =>
          appendAsMember(
            run,
            roster,
            { folderId, documentId, key: document.key },
            addition,
          ),
      );
      if (appended) added += 1;
    }
  }
  return added;
}

/**
 * Makes each dataset folder under the root and writes its notes. With the
 * roster, it also grants the folder's groups their access and has each
 * member append their lines. Idempotent: a rerun reuses the folder by name,
 * keeps held grants, and skips lines the note already has.
 */
export async function seedFolders(
  run: SeedRun,
  folders: readonly ContinuityFolder[],
  roster: FolderRoster | null,
): Promise<SeededFolders> {
  const { tracer } = run.session;
  const count = { folders: 0, notes: 0, grants: 0, additions: 0 };
  for (const folder of folders) {
    const folderId = await tracer.span(`folder ${folder.name}`, () =>
      ensureSeedFolder(run, folder.name),
    );
    run.folders.add(folderId);
    count.folders += 1;
    const notes = await seedFolderNotes(run, folderId, folder.notes);
    count.notes += notes.length;
    if (!roster) continue;
    count.grants += await tracer.span(`share ${folder.name}`, () =>
      grantFolder(run.session, folderId, folder.grants),
    );
    count.additions += await addMemberLines(run, roster, folderId, notes);
  }
  return count;
}
