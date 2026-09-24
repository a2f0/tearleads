import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import type { OrganizationPolicyHistoryResponse } from "@tearleads/validators/response";
import {
  getPrincipalStatePayloadForState,
  getPrincipalStatesForReferences,
  listPrincipalStateHistory,
  principalStateReferenceKey,
} from "../../access/read/principalStateStore";
import { buildPrincipalPolicySnapshotForStateWithExecutor } from "../principals/principalPolicyBundleRecords";
import { toPrincipalStatePayloadResponse } from "../principals/shared";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";
import {
  type OrganizationGroupHead,
  parseOrganizationAuthorityDescriptor,
} from "./organizationAuthorityDescriptor";

async function loadDirectoryPayloads(
  tx: DatabaseSession,
  organizationId: string,
  history: Awaited<ReturnType<typeof listPrincipalStateHistory>>,
) {
  const organizationPayloads: OrganizationPolicyHistoryResponse["organizationPayloads"] =
    [];
  const groupHeads = new Map<string, OrganizationGroupHead>();
  for (const { state } of history) {
    const payload = await getPrincipalStatePayloadForState(
      "organization",
      organizationId,
      state.stateHash,
      tx,
    );
    if (!payload)
      throw new Error("Organization policy history payload is missing");
    const descriptor = parseOrganizationAuthorityDescriptor(payload.ciphertext);
    if (!descriptor || descriptor.organizationId !== organizationId)
      throw new Error("Organization policy history descriptor is invalid");
    organizationPayloads.push(toPrincipalStatePayloadResponse(payload));
    for (const head of descriptor.groupHeads) {
      const previous = groupHeads.get(head.principalId);
      if (!previous || head.version > previous.version)
        groupHeads.set(head.principalId, head);
    }
  }
  return { organizationPayloads, groupHeads };
}

/** Read existing evidence at an exact organization head; never persist labels. */
export async function runGetOrganizationPolicyHistoryWorkflow(
  db: ApiDatabase,
  input: {
    organizationId: string;
    requesterUserId: string;
    stateHash: string;
  },
): Promise<OrganizationPolicyHistoryResponse> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId: input.organizationId,
      userId: input.requesterUserId,
    });
    const history = await listPrincipalStateHistory(
      "organization",
      input.organizationId,
      tx,
    );
    const target = history.find(
      (entry) => entry.state.stateHash === input.stateHash,
    );
    if (!target)
      throw new OrganizationManagerError(
        "Organization policy history unavailable",
        400,
      );
    const { organizationPayloads, groupHeads } = await loadDirectoryPayloads(
      tx,
      input.organizationId,
      history.filter((entry) => entry.state.version <= target.state.version),
    );
    const states = await getPrincipalStatesForReferences(
      [...groupHeads.values()],
      tx,
    );
    const groups: OrganizationPolicyHistoryResponse["groups"] = [];
    for (const head of groupHeads.values()) {
      const state = states.get(principalStateReferenceKey(head));
      if (!state)
        throw new Error("Organization policy history group state is missing");
      groups.push(
        await buildPrincipalPolicySnapshotForStateWithExecutor(tx, state),
      );
    }
    return {
      organizationId: input.organizationId,
      stateHash: input.stateHash,
      organizationPayloads,
      groups,
    };
  });
}
