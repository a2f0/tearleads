import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  computePrincipalStatePayloadCiphertextHash,
  principalPolicyMatchesReference,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import {
  type OrganizationPolicyHistoryResponse,
  PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE,
} from "@tearleads/validators/response";
import { loadOrganizationHistoryWindow } from "../../access/read/principalHistory";
import {
  getPrincipalStatesForReferences,
  principalStateReferenceKey,
} from "../../access/read/principalStateStore";
import { principalHistoryHead } from "../principals/principalHistoryRecords";
import { runPrincipalHistoryTransaction } from "../principals/principalHistoryTransaction";
import { loadPrincipalPolicySelections } from "../principals/principalPolicySelections";
import { issueProjectionPolicyHistoryGrant } from "../principals/projectionPolicyHistoryGrant";
import {
  PrincipalPolicyError,
  toPrincipalStatePayloadResponse,
} from "../principals/shared";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";
import { parseOrganizationAuthorityDescriptor } from "./organizationAuthorityDescriptor";

function reject(message: string): never {
  throw new PrincipalPolicyError(`Organization history: ${message}`, 409);
}

async function verifyWindow(
  executor: DatabaseSession,
  head: ReferencedPrincipalHead,
  rows: Awaited<ReturnType<typeof loadOrganizationHistoryWindow>>,
) {
  const references: ReferencedPrincipalHead[] = [principalHistoryHead(head)];
  const groupHeads = new Map<string, ReferencedPrincipalHead>();
  for (const { state, payload } of rows) {
    const hash = await computePrincipalStatePayloadCiphertextHash(
      payload.ciphertext,
    );
    if (hash !== payload.ciphertextHash || hash !== state.payloadCiphertextHash)
      reject("directory payload differs from its signed hash");
    const descriptor = parseOrganizationAuthorityDescriptor(payload.ciphertext);
    if (!descriptor || descriptor.organizationId !== head.principalId)
      reject("directory scope is invalid");
    references.push(principalHistoryHead(state), ...descriptor.groupHeads);
    for (const group of descriptor.groupHeads) {
      const previous = groupHeads.get(group.principalId);
      if (!previous || group.version > previous.version)
        groupHeads.set(group.principalId, group);
    }
  }
  const policies = await loadPrincipalPolicySelections(executor, references);
  for (const reference of references)
    if (
      !policies.some((policy) =>
        principalPolicyMatchesReference({ policy, reference }),
      )
    )
      reject("signed directory citation lacks verified inclusion");
  return [...groupHeads.values()];
}

/** Roster-only, bounded display evidence. Every continuation rechecks access. */
export async function runGetOrganizationPolicyHistoryWorkflow(
  db: ApiDatabase,
  input: {
    organizationId: string;
    requesterUserId: string;
    stateHash: string;
    beforeVersion?: number | undefined;
  },
): Promise<OrganizationPolicyHistoryResponse> {
  return runPrincipalHistoryTransaction(db, async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId: input.organizationId,
      userId: input.requesterUserId,
    });
    const target = {
      principalType: "organization" as const,
      principalId: input.organizationId,
      stateHash: input.stateHash,
    };
    const head = (await getPrincipalStatesForReferences([target], tx)).get(
      principalStateReferenceKey(target),
    );
    if (!head)
      throw new OrganizationManagerError(
        "Organization policy history unavailable",
        400,
      );
    const beforeVersion = input.beforeVersion ?? head.version + 1;
    if (
      !Number.isSafeInteger(beforeVersion) ||
      beforeVersion < 2 ||
      beforeVersion > head.version + 1
    )
      throw new OrganizationManagerError(
        "Organization history cursor is invalid",
        400,
      );
    const rows = await loadOrganizationHistoryWindow(
      tx,
      input.organizationId,
      beforeVersion,
    );
    const firstVersion = Math.max(
      1,
      beforeVersion - PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE - 1,
    );
    if (rows.length !== beforeVersion - firstVersion)
      reject("directory window is incomplete");
    const groupHeads = await verifyWindow(tx, head, rows);
    const source = (selected: ReferencedPrincipalHead) => ({
      head: principalHistoryHead(selected),
      grant: issueProjectionPolicyHistoryGrant({
        organizationId: input.organizationId,
        objectId: input.organizationId,
        objectKind: "organization",
        userId: input.requesterUserId,
        head: selected,
      }),
    });
    return {
      organizationId: input.organizationId,
      stateHash: input.stateHash,
      beforeVersion,
      nextBeforeVersion:
        beforeVersion > PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE + 1
          ? beforeVersion - PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE
          : null,
      evidence: {
        organization: source(head),
        organizationPayloads: rows.map(({ state, payload }) => ({
          reference: principalHistoryHead(state),
          payload: toPrincipalStatePayloadResponse(payload),
        })),
        groups: groupHeads.map(source),
      },
    };
  });
}
