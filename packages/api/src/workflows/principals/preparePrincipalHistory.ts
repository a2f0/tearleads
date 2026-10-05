import { Buffer } from "node:buffer";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { PrincipalHistoryVerificationKind } from "@tearleads/api-shared/schema";
import type {
  PrincipalPolicyExternalAuthority,
  PrincipalPolicyHistoryInput,
  PrincipalPolicyHistoryVerifier,
  PrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicyHistory,
} from "@tearleads/crypto";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import {
  resetBufferedPrincipalHistoryProgress,
  saveBufferedPrincipalHistoryNodes,
} from "./principalHistoryCache";
import type {
  PrincipalHistoryPreparationPending,
  PrincipalHistoryPreparationRequest,
} from "./principalHistoryPreparationRequest";
import { principalHistoryProtection } from "./principalHistoryProtection";
import {
  principalHistoryError,
  principalHistoryHead,
  principalHistorySigner,
  readPrincipalHistoryEntry,
} from "./principalHistoryRecords";
import {
  requestedPrincipalHistoryReferences,
  selectStoredPrincipalHistoryReferences,
} from "./principalHistoryReferences";
import {
  resumeStoredPrincipalHistory,
  saveStoredPrincipalHistory,
} from "./principalHistoryResume";

export interface PrincipalHistoryPreparationBudget {
  acceptedEntries: number;
  remainingEntries: number;
  remainingBytes: number;
  readonly deadline: number;
}

export function principalHistoryPreparationBudget(): PrincipalHistoryPreparationBudget {
  return {
    acceptedEntries: 0,
    remainingEntries: 32,
    remainingBytes: 2 * 1024 * 1024,
    deadline: performance.now() + 5_000,
  };
}

export type PrincipalHistoryPreparation =
  | {
      readonly complete: true;
      readonly history: VerifiedPrincipalPolicyHistory;
    }
  | PrincipalHistoryPreparationPending;

function canPrepare(budget: PrincipalHistoryPreparationBudget): boolean {
  return (
    budget.acceptedEntries === 0 ||
    (budget.remainingEntries > 0 &&
      budget.remainingBytes > 0 &&
      performance.now() < budget.deadline)
  );
}

async function prepareAuthority(
  executor: DatabaseSession,
  entry: PrincipalPolicyStateChainEntry,
  budget: PrincipalHistoryPreparationBudget,
): Promise<
  | {
      readonly complete: true;
      readonly authority: PrincipalPolicyExternalAuthority;
      readonly request: PrincipalHistoryPreparationRequest;
    }
  | PrincipalHistoryPreparationPending
> {
  const reference = entry.state.externalAuthority;
  if (!reference)
    throw principalHistoryError("policy", "external authority is missing");
  const current = await getCurrentPrincipalState(
    "group",
    reference.principalId,
    executor,
  );
  if (!current)
    throw principalHistoryError("authority", "external authority is missing");
  const request: PrincipalHistoryPreparationRequest = {
    head: principalHistoryHead(current),
    kind: "authority",
    retainedReferences: [reference],
  };
  const prepared = await preparePrincipalHistory(executor, {
    ...request,
    budget,
  });
  if (!prepared.complete) return prepared;
  return {
    complete: true,
    request,
    authority: {
      currentHead: { ...principalHistoryHead(current), principalType: "group" },
      states: prepared.history.retainedEntries.map(({ state, projection }) => ({
        head: { ...principalHistoryHead(state), principalType: "group" },
        projection,
      })),
    },
  };
}

async function appendStoredEntry(input: {
  readonly executor: DatabaseSession;
  readonly verifier: PrincipalPolicyHistoryVerifier;
  readonly entry: PrincipalPolicyStateChainEntry;
  readonly kind: PrincipalHistoryVerificationKind;
  readonly budget: PrincipalHistoryPreparationBudget;
}): Promise<{ readonly complete: true } | PrincipalHistoryPreparationPending> {
  const { entry, kind, budget, executor, verifier } = input;
  if (
    kind === "authority" &&
    (entry.projection.length === 0 ||
      entry.projection.some((member) => member.role !== "admin"))
  )
    throw principalHistoryError(
      kind,
      "reserved Admins history contains a non-admin projection",
    );
  const page = {
    entries: [entry],
    signerPublicKeys: [await principalHistorySigner(executor, entry, kind)],
  };
  let result = await verifier.append(page);
  if (
    !result.ok &&
    result.error.code === "unauthorized" &&
    kind === "policy" &&
    entry.state.externalAuthority &&
    entry.state.externalAuthority.principalId !== entry.state.principalId
  ) {
    const authority = await prepareAuthority(executor, entry, budget);
    if (!authority.complete) return authority;
    if (!canPrepare(budget))
      return { complete: false, request: authority.request };
    result = await verifier.append({
      ...page,
      externalAuthority: authority.authority,
    });
  }
  if (!result.ok) throw principalHistoryError(kind, result.error.message);
  await saveBufferedPrincipalHistoryNodes(executor, result.value.indexNodes);
  // Charge accepted work after dependencies can advance. Charging an
  // unresolved parent first could starve its authority on every retry.
  // One entry can exceed the preferred byte/time budget, and discovery can
  // inspect one unresolved parent in addition to the accepted batch.
  budget.acceptedEntries += 1;
  budget.remainingEntries -= 1;
  budget.remainingBytes -=
    Buffer.byteLength(JSON.stringify(entry)) +
    Buffer.byteLength(JSON.stringify(result.value.indexNodes));
  return { complete: true };
}

/**
 * Prepare a bounded portion of stored history. This verifies historical
 * authorization only; the final mutation must check current authorization and
 * compare-and-swap heads separately in its transaction. Use a shared budget
 * across a request's policy and authority dependencies.
 */
export async function preparePrincipalHistory(
  executor: DatabaseSession,
  request: {
    readonly head: ReferencedPrincipalHead;
    readonly kind?: PrincipalHistoryVerificationKind;
    readonly retainedReferences?: readonly ReferencedPrincipalHead[];
    readonly budget: PrincipalHistoryPreparationBudget;
  },
): Promise<PrincipalHistoryPreparation> {
  const head = principalHistoryHead(request.head);
  const { budget } = request;
  const kind = request.kind ?? "policy";
  if (kind === "authority" && head.principalType !== "group")
    throw principalHistoryError(kind, "external authority is not a group");
  const references = requestedPrincipalHistoryReferences(
    head,
    request.retainedReferences ?? [],
  );
  const input: PrincipalPolicyHistoryInput = {
    principalType: head.principalType,
    principalId: head.principalId,
    retainedReferences: [],
  };
  const pending: PrincipalHistoryPreparationPending = {
    complete: false,
    request: { head, kind, retainedReferences: references },
  };
  const local = principalHistoryProtection(input, kind);
  try {
    const resumed = await resumeStoredPrincipalHistory(
      executor,
      input,
      head.version,
      local,
    );
    // Removing one unusable hint is bounded progress; the next request can
    // resume an earlier hint without repeatedly selecting this invalid row.
    if (resumed.discarded) return pending;
    let version = resumed.throughVersion;
    let acceptedHead: ReferencedPrincipalHead | undefined;
    let dependency: PrincipalHistoryPreparationPending | undefined;
    while (version < head.version && canPrepare(budget)) {
      const entry = await readPrincipalHistoryEntry(
        executor,
        head,
        version + 1,
        kind,
      );
      const appended = await appendStoredEntry({
        executor,
        verifier: resumed.verifier,
        entry,
        kind,
        budget,
      });
      if (!appended.complete) {
        dependency = appended;
        break;
      }
      version = entry.state.version;
      acceptedHead = entry.state;
    }
    if (acceptedHead)
      await saveStoredPrincipalHistory(
        executor,
        resumed.verifier,
        acceptedHead,
        local,
      );
    if (version !== head.version) return dependency ?? pending;
    const finished = resumed.verifier.finish(head);
    if (!finished.ok) throw principalHistoryError(kind, finished.error.message);
    const selected = await selectStoredPrincipalHistoryReferences(
      executor,
      finished.value,
      references,
      kind,
    );
    if (!selected) {
      await resetBufferedPrincipalHistoryProgress(executor, {
        ...local.scope,
        throughVersion: head.version,
      });
      return pending;
    }
    return { complete: true, history: selected };
  } finally {
    local.protection.localKey.fill(0);
  }
}
