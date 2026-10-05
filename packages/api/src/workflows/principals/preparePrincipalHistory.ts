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
import { principalHistoryProtection } from "./principalHistoryProtection";
import {
  principalHistoryError,
  principalHistoryHead,
  principalHistorySigner,
  readPrincipalHistoryEntry,
} from "./principalHistoryRecords";
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
  | { readonly complete: false };

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
): Promise<PrincipalPolicyExternalAuthority | null> {
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
  const prepared = await preparePrincipalHistory(executor, {
    head: current,
    kind: "authority",
    retainedReferences: [reference],
    budget,
  });
  if (!prepared.complete) return null;
  return {
    currentHead: { ...principalHistoryHead(current), principalType: "group" },
    states: prepared.history.retainedEntries.map(({ state, projection }) => ({
      head: { ...principalHistoryHead(state), principalType: "group" },
      projection,
    })),
  };
}

async function appendStoredEntry(input: {
  readonly executor: DatabaseSession;
  readonly verifier: PrincipalPolicyHistoryVerifier;
  readonly entry: PrincipalPolicyStateChainEntry;
  readonly kind: PrincipalHistoryVerificationKind;
  readonly budget: PrincipalHistoryPreparationBudget;
}): Promise<boolean> {
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
    const externalAuthority = await prepareAuthority(executor, entry, budget);
    if (!externalAuthority || !canPrepare(budget)) return false;
    result = await verifier.append({ ...page, externalAuthority });
  }
  if (!result.ok) throw principalHistoryError(kind, result.error.message);
  // Charge accepted work after dependencies can advance. Charging an
  // unresolved parent first could starve its authority on every retry.
  // One entry can exceed the preferred byte/time budget, and discovery can
  // inspect one unresolved parent in addition to the accepted batch.
  budget.acceptedEntries += 1;
  budget.remainingEntries -= 1;
  budget.remainingBytes -= Buffer.byteLength(JSON.stringify(entry));
  return true;
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
  const input: PrincipalPolicyHistoryInput = {
    principalType: head.principalType,
    principalId: head.principalId,
    retainedReferences: (request.retainedReferences ?? []).map(
      principalHistoryHead,
    ),
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
    if (resumed.discarded) return { complete: false };
    let version = resumed.throughVersion;
    let acceptedHead: ReferencedPrincipalHead | undefined;
    while (version < head.version && canPrepare(budget)) {
      const entry = await readPrincipalHistoryEntry(
        executor,
        head,
        version + 1,
        kind,
      );
      if (
        !(await appendStoredEntry({
          executor,
          verifier: resumed.verifier,
          entry,
          kind,
          budget,
        }))
      )
        break;
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
    if (version !== head.version) return { complete: false };
    const finished = resumed.verifier.finish(head);
    if (!finished.ok) throw principalHistoryError(kind, finished.error.message);
    return { complete: true, history: finished.value };
  } finally {
    local.protection.localKey.fill(0);
  }
}
