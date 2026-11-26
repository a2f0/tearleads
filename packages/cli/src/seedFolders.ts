import type { DocumentStore } from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  appendNoteAddition,
  type ContinuityFolder,
  captureContinuityScope,
  openReadyContainerTree,
} from "app/continuity";
import { loadFolderTree } from "./folderTree";
import {
  confirmDocumentSynced,
  type SeedRun,
  seedContinuityDocument,
  seedDocumentIds,
} from "./seedDocument";
import { removeEmptySeedFolder, resolveSeedFolder } from "./seedFolderTarget";
import { type CliSession, withSession } from "./session";

// A group grant reaches a member's device as the organization read model and
// the folder's key wrap catch up, which takes a few round trips. Attempts
// stop at one deadline, which also bounds each attempt's discovery and sync.
const SETTLE_TIMEOUT_MS = 120_000;
const SETTLE_DELAY_MS = 250;

/** What folder grants and members' note additions need from `--roster`. */
export interface FolderRoster {
  readonly apiBaseUrl: string;
  /** The recovery key of the member with this Continuity contact ID. */
  readonly memberRecoveryKey: (contactId: string) => string;
}

/** A written note, the folder it is in, and the lines it still lacks. */
type SeededNote = ContinuityFolder["notes"][number] & {
  readonly containerId: string;
};

export interface SeededFolders {
  readonly folders: number;
  readonly notes: number;
  readonly grants: number;
  readonly additions: number;
  /** Notes moved out of their folder, whose missing lines were skipped. */
  readonly moved: number;
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
    // The group the roster seed made or reused: never a built-in group or one
    // whose name does not open.
    const groupId = state.groups.find(
      (group) =>
        !group.isBuiltin && !group.nameUnreadable && group.name === name,
    )?.groupId;
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

/** A note to add a line to: its folder, document, and dataset key. */
interface NoteTarget {
  readonly folderId: string;
  readonly documentId: string;
  readonly key: string;
}

/** The note as the member's device sees it, once their grant has reached it. */
async function openSharedNote(
  member: CliSession,
  organizationId: string,
  target: NoteTarget,
  deadline: AbortSignal,
): Promise<DocumentStore | null> {
  const { sdk } = member;
  const { folderId, documentId } = target;
  // The shared folder joins the member's tree once their grant reaches it.
  await loadFolderTree(member, { organizationId });
  // Discovery returns only what is new, so the note may have arrived in an
  // earlier attempt: drain it, then find the note on the device by its ID.
  let batch = await sdk.containerContents.discoverContainerDocuments(folderId);
  while (batch?.length && !deadline.aborted) {
    batch = await sdk.containerContents.discoverContainerDocuments(folderId);
  }
  if (deadline.aborted) return null;
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
  target: NoteTarget,
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
      const store = await settle(
        (deadline) => openSharedNote(member, organizationId, target, deadline),
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
): Promise<SeededNote[]> {
  const written = [];
  for (const note of notes) {
    const seeded = await seedContinuityDocument(run, note.document, folderId);
    if (seeded === "purged") continue;
    const { text } = seeded.store.getSnapshot();
    written.push({
      document: note.document,
      // The user may have moved the note out of the folder since.
      containerId: seeded.containerId,
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
  notes: readonly SeededNote[],
): Promise<number> {
  let added = 0;
  for (const { document, containerId, additions } of notes) {
    const { documentId } = await seedDocumentIds(run, document.key);
    for (const addition of additions) {
      const appended = await run.session.tracer.span(
        `add ${document.key} by ${addition.author}`,
        () =>
          appendAsMember(
            run,
            roster,
            { folderId: containerId, documentId, key: document.key },
            addition,
          ),
      );
      if (appended) added += 1;
    }
  }
  return added;
}

/** Seeds one dataset folder into the counts: its folder, notes, and lines. */
async function seedFolder(
  run: SeedRun,
  folder: ContinuityFolder,
  roster: FolderRoster | null,
  count: { -readonly [K in keyof SeededFolders]: number },
): Promise<void> {
  const { tracer } = run.session;
  let target = await tracer.span(`folder ${folder.name}`, () =>
    resolveSeedFolder(run, folder),
  );
  if (target) run.folders.add(target.id);
  // A note that exists stays where it is; a new one goes into the folder.
  const notes = await seedFolderNotes(
    run,
    target?.id ?? run.rootId,
    folder.notes,
  );
  const inFolder = notes.filter((note) => note.containerId === target?.id);
  if (target?.created && inFolder.length === 0) {
    await removeEmptySeedFolder(run, target.id);
    target = null;
  }
  if (target) count.folders += 1;
  count.notes += notes.length;
  if (!roster) return;
  if (target) {
    const folderId = target.id;
    count.grants += await tracer.span(`share ${folder.name}`, () =>
      grantFolder(run.session, folderId, folder.grants),
    );
  }
  count.moved += notes.filter(
    (note) => note.containerId !== target?.id && note.additions.length > 0,
  ).length;
  count.additions += await addMemberLines(run, roster, inFolder);
}

/**
 * Makes each dataset folder under the root and writes its notes. With the
 * roster, it also grants the folder's groups their access and has each
 * member append their lines. Idempotent: a rerun finds the folder through
 * its notes, keeps held grants, and skips lines the note already has. Only
 * the seed's own folder is shared: a note the user moved elsewhere stays
 * private to them, so its missing lines are skipped and counted.
 */
export async function seedFolders(
  run: SeedRun,
  folders: readonly ContinuityFolder[],
  roster: FolderRoster | null,
): Promise<SeededFolders> {
  const count = { folders: 0, notes: 0, grants: 0, additions: 0, moved: 0 };
  for (const folder of folders) {
    await seedFolder(run, folder, roster, count);
  }
  return count;
}
