import {
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import {
  isPrincipalPolicyBundleResponse,
  isPrincipalPolicySnapshotPage,
  isPrincipalPolicyStateChainEntryResponse,
  type PrincipalPolicySnapshotPage,
  type PrincipalPolicyStateChainEntryResponse,
} from "@tearleads/validators/response";
import { PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT } from "@tearleads/validators/util";
import { and, eq, inArray, or } from "drizzle-orm";
import { principalHeadMatchesReference } from "../../principalContracts/organizationAuthorityDescriptor";
import {
  principalPolicyBundleReferences,
  principalPolicyBundles,
} from "../../sqlite/schema";
import {
  principalHistoryEntries,
  principalHistoryEntryStateHashJson,
} from "../../sqlite/schema/principalHistoryEvidenceSchema";
import type { ClientSQLiteDatabase } from "../../sqlite/sqlitePersistenceRuntime";
import { principalPolicyBundleSelection } from "./principalPolicyPersistence";
import { storedPrincipalPolicyBundleFromJson } from "./storedPrincipalPolicyBundle";

/** Maximum entries per held page, respecting both wire and verifier budgets. */
const HELD_PAGE_ENTRY_LIMIT = Math.min(
  PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT,
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
);
/** Candidate rows per source; equal hashes rarely repeat across scopes. */
const HELD_CANDIDATE_LIMIT = 8;
/** Maximum backward hash walk over evidence rows before falling back online. */
const MAX_EVIDENCE_CHAIN_WALK = 64;

function parsedJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function contiguousChain(
  entries: readonly PrincipalPolicyStateChainEntryResponse[],
  head: ReferencedPrincipalHead,
  startVersion: number,
): boolean {
  const expectedCount = head.version - startVersion + 1;
  if (entries.length !== expectedCount) return false;
  const last = entries.at(-1);
  if (!last || !principalHeadMatchesReference(last.state, head)) return false;
  return entries.every(
    (entry, index) =>
      entry.state.principalType === head.principalType &&
      entry.state.principalId === head.principalId &&
      entry.state.version === startVersion + index,
  );
}

/**
 * Paginates a locally held entry suffix (`afterVersion + 1 .. head.version`)
 * into `PrincipalPolicySnapshotPage` chunks within the verifier's batch budget.
 */
function paginateHeldEntries(
  tailEntries: readonly PrincipalPolicyStateChainEntryResponse[],
  head: ReferencedPrincipalHead,
  afterVersion: number,
): readonly PrincipalPolicySnapshotPage[] | null {
  if (!contiguousChain(tailEntries, head, afterVersion + 1)) return null;
  const current = tailEntries.at(-1);
  if (!current) return null;
  const previous = tailEntries.slice(0, -1);
  const pages: PrincipalPolicySnapshotPage[] = [];
  let offset = 0;
  let cursor = afterVersion;
  while (previous.length - offset >= HELD_PAGE_ENTRY_LIMIT) {
    const chunk = previous.slice(offset, offset + HELD_PAGE_ENTRY_LIMIT);
    const nextAfterVersion = cursor + chunk.length;
    const page: PrincipalPolicySnapshotPage = {
      currentState: current.state,
      currentProjection: current.projection,
      currentGrants: current.grants,
      previousStates: chunk,
      historyPage: { afterVersion: cursor, nextAfterVersion },
    };
    if (!isPrincipalPolicySnapshotPage(page)) return null;
    pages.push(page);
    offset += chunk.length;
    cursor = nextAfterVersion;
  }
  const finalPage: PrincipalPolicySnapshotPage = {
    currentState: current.state,
    currentProjection: current.projection,
    currentGrants: current.grants,
    previousStates: previous.slice(offset),
    historyPage: { afterVersion: cursor, nextAfterVersion: null },
  };
  if (!isPrincipalPolicySnapshotPage(finalPage)) return null;
  pages.push(finalPage);
  return pages;
}

/** Extracts `afterVersion + 1 .. head.version` from one cached policy bundle row. */
function bundleChainTail(
  row: {
    readonly currentMemberEnvelopesJson: string;
    readonly currentPayloadJson: string;
    readonly currentProjectionJson: string;
    readonly currentGrantsJson: string;
    readonly currentStateJson: string;
    readonly previousStatesJson: string;
  },
  head: ReferencedPrincipalHead,
  afterVersion: number,
): readonly PrincipalPolicyStateChainEntryResponse[] | null {
  let parsed: unknown;
  try {
    parsed = storedPrincipalPolicyBundleFromJson(row);
  } catch {
    return null;
  }
  if (!isPrincipalPolicyBundleResponse(parsed)) return null;
  const fullChain: PrincipalPolicyStateChainEntryResponse[] = [
    ...parsed.previousStates,
    {
      state: parsed.currentState,
      projection: parsed.currentProjection,
      grants: parsed.currentGrants,
    },
  ];
  if (fullChain.length < head.version) return null;
  const tail = fullChain.slice(afterVersion, head.version);
  return contiguousChain(tail, head, afterVersion + 1) ? tail : null;
}

/** Loads a held chain from cached principal policy bundles (current or retained). */
async function loadBundleChainTail(
  db: ClientSQLiteDatabase,
  head: ReferencedPrincipalHead,
  afterVersion: number,
): Promise<readonly PrincipalPolicyStateChainEntryResponse[] | null> {
  const indexed = db
    .selectDistinct({
      bundleStateHash: principalPolicyBundleReferences.bundleStateHash,
    })
    .from(principalPolicyBundleReferences)
    .where(
      and(
        eq(principalPolicyBundleReferences.principalType, head.principalType),
        eq(principalPolicyBundleReferences.principalId, head.principalId),
        eq(principalPolicyBundleReferences.version, head.version),
        eq(principalPolicyBundleReferences.stateHash, head.stateHash),
        eq(principalPolicyBundleReferences.keyEpoch, head.keyEpoch),
        eq(principalPolicyBundleReferences.keyFingerprint, head.keyFingerprint),
      ),
    )
    .limit(HELD_CANDIDATE_LIMIT);
  const rows = await db
    .select(principalPolicyBundleSelection)
    .from(principalPolicyBundles)
    .where(
      and(
        eq(principalPolicyBundles.principalType, head.principalType),
        eq(principalPolicyBundles.principalId, head.principalId),
        or(
          eq(principalPolicyBundles.stateHash, head.stateHash),
          inArray(principalPolicyBundles.stateHash, indexed),
        ),
      ),
    );
  for (const row of rows) {
    const tail = bundleChainTail(row, head, afterVersion);
    if (tail) return tail;
  }
  return null;
}

async function selectEvidenceEntry(
  db: ClientSQLiteDatabase,
  head: ReferencedPrincipalHead,
  version: number,
  stateHash: string,
): Promise<PrincipalPolicyStateChainEntryResponse | null> {
  const rows = await db
    .select({ entryJson: principalHistoryEntries.entryJson })
    .from(principalHistoryEntries)
    .where(
      eq(
        principalHistoryEntryStateHashJson(principalHistoryEntries.entryJson),
        stateHash,
      ),
    )
    .limit(HELD_CANDIDATE_LIMIT);
  for (const { entryJson } of rows) {
    const entry = parsedJson(entryJson);
    if (
      isPrincipalPolicyStateChainEntryResponse(entry) &&
      entry.state.principalType === head.principalType &&
      entry.state.principalId === head.principalId &&
      entry.state.version === version &&
      entry.state.stateHash === stateHash &&
      (version !== head.version ||
        principalHeadMatchesReference(entry.state, head))
    ) {
      return entry;
    }
  }
  return null;
}

/** Walks signed history evidence rows backwards from `head` down to `afterVersion + 1`. */
async function loadEvidenceChainTail(
  db: ClientSQLiteDatabase,
  head: ReferencedPrincipalHead,
  afterVersion: number,
): Promise<readonly PrincipalPolicyStateChainEntryResponse[] | null> {
  const needed = head.version - afterVersion;
  if (needed < 1 || needed > MAX_EVIDENCE_CHAIN_WALK) return null;
  const reversed: PrincipalPolicyStateChainEntryResponse[] = [];
  let expectedVersion = head.version;
  let expectedHash: string | null = head.stateHash;
  while (expectedVersion > afterVersion) {
    if (!expectedHash) return null;
    const entry = await selectEvidenceEntry(
      db,
      head,
      expectedVersion,
      expectedHash,
    );
    if (!entry) return null;
    reversed.push(entry);
    expectedHash = entry.state.prevStateHash;
    expectedVersion -= 1;
  }
  reversed.reverse();
  return contiguousChain(reversed, head, afterVersion + 1) ? reversed : null;
}

/**
 * Reconstructs paginated public-history pages from locally held policy bundles
 * or history evidence. Untrusted: the caller verifies every page through the
 * same cryptographic verifier as served network pages, falling back online on
 * any mismatch or verification failure.
 */
export async function selectHeldPrincipalHistoryPages(
  db: ClientSQLiteDatabase,
  head: ReferencedPrincipalHead,
  afterVersion: number,
): Promise<readonly PrincipalPolicySnapshotPage[] | null> {
  if (
    !Number.isSafeInteger(afterVersion) ||
    afterVersion < 0 ||
    afterVersion >= head.version
  ) {
    return null;
  }
  const tail =
    (await loadBundleChainTail(db, head, afterVersion)) ??
    (await loadEvidenceChainTail(db, head, afterVersion));
  return tail ? paginateHeldEntries(tail, head, afterVersion) : null;
}
