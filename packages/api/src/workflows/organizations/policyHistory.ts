import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { OrganizationPolicyHistoryResponse } from "@tearleads/validators/response";
import {
  listGroupHistoryThroughHeads,
  listOrganizationHistoryPayloads,
} from "../../access/read/principalHistory";
import {
  toPrincipalStatePayloadResponse,
  toPrincipalStateResponse,
} from "../principals/shared";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";
import {
  type OrganizationGroupHead,
  parseOrganizationAuthorityDescriptor,
} from "./organizationAuthorityDescriptor";

function collectGroupHeads(
  organizationId: string,
  payloads: OrganizationPolicyHistoryResponse["organizationPayloads"],
) {
  const groupHeads = new Map<string, OrganizationGroupHead>();
  for (const payload of payloads) {
    const descriptor = parseOrganizationAuthorityDescriptor(payload.ciphertext);
    if (!descriptor || descriptor.organizationId !== organizationId)
      throw new Error("Organization policy history descriptor is invalid");
    for (const head of descriptor.groupHeads) {
      const previous = groupHeads.get(head.principalId);
      if (!previous || head.version > previous.version)
        groupHeads.set(head.principalId, head);
    }
  }
  return [...groupHeads.values()];
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
    const payloads = await listOrganizationHistoryPayloads(
      tx,
      input.organizationId,
      input.stateHash,
    );
    if (!payloads)
      throw new OrganizationManagerError(
        "Organization policy history unavailable",
        400,
      );
    const organizationPayloads = payloads.map(toPrincipalStatePayloadResponse);
    const groupHeads = collectGroupHeads(
      input.organizationId,
      organizationPayloads,
    );
    const history = await listGroupHistoryThroughHeads(tx, groupHeads);
    const groups = groupHeads.map((head) => {
      const entries = history
        .filter((entry) => entry.state.principalId === head.principalId)
        .map((entry) => ({
          state: toPrincipalStateResponse(entry.state),
          projection: entry.projection.map(({ userId, role }) => ({
            userId,
            role,
          })),
          grants: entry.grants.map(({ containerId, accessLevel }) => ({
            containerId,
            accessLevel,
          })),
        }));
      const current = entries.pop();
      if (!current || current.state.stateHash !== head.stateHash)
        throw new Error("Organization policy history group state is missing");
      return {
        currentState: current.state,
        currentProjection: current.projection,
        currentGrants: current.grants,
        previousStates: entries,
      };
    });
    return {
      organizationId: input.organizationId,
      stateHash: input.stateHash,
      organizationPayloads,
      groups,
    };
  });
}
