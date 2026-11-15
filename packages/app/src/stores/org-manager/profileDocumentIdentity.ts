import {
  type Documents,
  type DocumentsRuntime,
  defaultDocumentsPersistence,
  deriveStableDocumentId,
} from "@tearleads/client-sdk";
import { loadDocumentIdentityCandidates } from "../documents/documentIdentityCandidates";
import { sameDocumentsAuthority } from "../documents/documentsAuthority";

type ProfileDocumentIdentity =
  | {
      readonly status: "existing" | "create";
      readonly localId: string;
      readonly documentId: string | null;
      readonly runtime: DocumentsRuntime;
    }
  | { readonly status: "unavailable" };

type ProfileRecord = NonNullable<
  Awaited<ReturnType<typeof defaultDocumentsPersistence.loadDocument>>
>;

interface ProfileIdentityInput {
  readonly containerId: string;
  readonly documents: Documents;
  readonly preferredLocalId: string;
  readonly documentId?: string | null | undefined;
  readonly stillCurrent: () => boolean;
}

// The caller's `stillCurrent` carries the authority generation (A -> B -> A);
// this field check additionally pins the runtime the lookup reads through.
function sameRuntime(left: DocumentsRuntime, right: DocumentsRuntime): boolean {
  return (
    right.infra.dbStatus === "ready" && sameDocumentsAuthority(left, right)
  );
}

async function recordIdentity(record: ProfileRecord): Promise<string> {
  return (
    record.documentId ??
    record.recoveryDocumentId ??
    (await deriveStableDocumentId(record.id))
  );
}

function existingIdentity(
  record: ProfileRecord,
  runtime: DocumentsRuntime,
): ProfileDocumentIdentity {
  return {
    status: "existing",
    localId: record.id,
    documentId: record.documentId ?? record.recoveryDocumentId ?? null,
    runtime,
  };
}

interface ProfileLookup {
  readonly runtime: DocumentsRuntime;
  readonly current: () => boolean;
  readonly target: string;
  readonly containerId: string;
  readonly owner: string | null;
}

async function inspectProfileCandidate(
  lookup: ProfileLookup,
  localId: string,
): Promise<ProfileDocumentIdentity | { readonly status: "continue" }> {
  const { runtime, current, target, containerId, owner } = lookup;
  const record = await defaultDocumentsPersistence.loadDocument(
    runtime.infra.execSql,
    localId,
  );
  if (!current()) return { status: "unavailable" };
  if (!record) {
    return { status: localId === owner ? "unavailable" : "continue" };
  }
  const identity = await recordIdentity(record);
  if (!current()) return { status: "unavailable" };
  if (identity === target) {
    // Without a current owner the match is a recovery alias. It is this
    // profile only in the profile container; never open or rebirth elsewhere.
    return owner === null && record.containerId !== containerId
      ? { status: "unavailable" }
      : existingIdentity(record, runtime);
  }
  // Never open an occupied key with a different requested remote identity.
  return {
    status:
      localId === target || localId === owner ? "unavailable" : "continue",
  };
}

async function resolveOtherProfileOwner(
  lookup: Omit<ProfileLookup, "owner">,
): Promise<ProfileDocumentIdentity | { readonly status: "continue" }> {
  const { runtime, current, target } = lookup;
  const { execSql } = runtime.infra;
  const owner = await defaultDocumentsPersistence.findLocalIdByDocumentId(
    execSql,
    target,
  );
  if (!current()) return { status: "unavailable" };
  // Recovery-only identities are absent from the current-identity lookup.
  // Select their metadata rather than loading every history in the container,
  // and keep out-of-place matches so placement refuses them.
  const candidates = owner
    ? [owner]
    : [
        target,
        ...(
          await loadDocumentIdentityCandidates(execSql, target, [target])
        ).map((row) => row.localId),
      ];
  if (!current()) return { status: "unavailable" };
  for (const localId of new Set(candidates)) {
    const candidate = await inspectProfileCandidate(
      { ...lookup, owner },
      localId,
    );
    if (candidate.status !== "continue") return candidate;
  }
  return { status: "continue" };
}

/**
 * A profile's preferred local key is a birth preference, not its remote identity.
 * Resolve current-format discovery/recovery without rewriting or adopting rows.
 * The caller's generation predicate also fences A-B-A runtime transitions.
 */
export async function resolveProfileDocumentIdentity(
  input: ProfileIdentityInput,
): Promise<ProfileDocumentIdentity> {
  const runtime = input.documents.workflowRuntime(input.containerId);
  const current = () =>
    input.stillCurrent() &&
    sameRuntime(runtime, input.documents.workflowRuntime(input.containerId));
  if (!current()) return { status: "unavailable" };
  const { execSql } = runtime.infra;
  await defaultDocumentsPersistence.ensureSchema(execSql);
  if (!current()) return { status: "unavailable" };
  const preferred = await defaultDocumentsPersistence.loadDocument(
    execSql,
    input.preferredLocalId,
  );
  if (!current()) return { status: "unavailable" };
  const target =
    input.documentId ??
    (preferred
      ? await recordIdentity(preferred)
      : await deriveStableDocumentId(input.preferredLocalId));
  if (!current()) return { status: "unavailable" };
  if (preferred && (await recordIdentity(preferred)) === target) {
    return current()
      ? existingIdentity(preferred, runtime)
      : { status: "unavailable" };
  }
  const selected = await resolveOtherProfileOwner({
    runtime,
    current,
    target,
    containerId: input.containerId,
  });
  if (!current()) return { status: "unavailable" };
  if (selected.status !== "continue") return selected;
  return {
    status: "create",
    localId: preferred ? target : input.preferredLocalId,
    documentId: input.documentId ?? null,
    runtime,
  };
}
