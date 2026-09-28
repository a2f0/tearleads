import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { listOrganizationHistoryPayloads } from "../../access/read/principalHistory";
import { ByteBudgetCache } from "../../utils/byteBudgetCache";
import { parseOrganizationAuthorityDescriptor } from "../organizations/organizationAuthorityDescriptor";
import { PrincipalPolicyError } from "./shared";

type DirectoryPayload = NonNullable<
  Awaited<ReturnType<typeof listOrganizationHistoryPayloads>>
>[number];
interface DirectoryBindings {
  latest: Map<string, ReferencedPrincipalHead>;
  adminGroupIds: Set<string>;
  bindingPayloadByGroupState: Map<string, DirectoryPayload>;
}

// Retained directory payloads are immutable beneath the stored organization
// head. Cache only parsed bindings; object authorization still precedes this.
const bindingsByHead = new ByteBudgetCache<DirectoryBindings>(32 * 1024 * 1024);
const MAX_CACHED_SOURCE_CHARACTERS = 4_000_000;

/** Drop process-local derived state, including for cold-loader fault tests. */
export function clearProjectionDirectoryBindingsCache(): void {
  bindingsByHead.clear();
}

function directoryBindings(
  payloads: readonly DirectoryPayload[],
  organizationId: string,
): DirectoryBindings {
  const latest = new Map<string, ReferencedPrincipalHead>();
  const adminGroupIds = new Set<string>();
  const bindingPayloadByGroupState = new Map<string, DirectoryPayload>();
  for (const payload of payloads) {
    const directory = parseOrganizationAuthorityDescriptor(payload.ciphertext);
    if (!directory || directory.organizationId !== organizationId)
      throw new PrincipalPolicyError(
        "Projection directory organization mismatch",
        409,
      );
    adminGroupIds.add(directory.adminGroupId);
    for (const head of directory.groupHeads) {
      const previous = latest.get(head.principalId);
      if (!previous || head.version > previous.version) {
        if (previous) bindingPayloadByGroupState.delete(previous.stateHash);
        latest.set(head.principalId, head);
        bindingPayloadByGroupState.set(head.stateHash, payload);
      }
    }
  }
  return { latest, adminGroupIds, bindingPayloadByGroupState };
}

export async function loadProjectionDirectoryBindings(input: {
  executor: DatabaseSession;
  organizationId: string;
  stateHash: string;
}): Promise<DirectoryBindings> {
  const key = `${input.organizationId}:${input.stateHash}`;
  const cached = bindingsByHead.get(key);
  if (cached) {
    return structuredClone(cached);
  }
  const payloads = await listOrganizationHistoryPayloads(
    input.executor,
    input.organizationId,
    input.stateHash,
  );
  if (!payloads)
    throw new PrincipalPolicyError("Projection directory history missing", 409);
  const bindings = directoryBindings(payloads, input.organizationId);
  if (JSON.stringify(payloads).length <= MAX_CACHED_SOURCE_CHARACTERS) {
    // Many groups share one directory payload; charge each retained body once.
    const size =
      JSON.stringify({
        heads: [...bindings.latest.values()],
        admins: [...bindings.adminGroupIds],
        payloads: [...new Set(bindings.bindingPayloadByGroupState.values())],
      }).length *
        4 +
      bindings.latest.size * 256;
    bindingsByHead.set(key, structuredClone(bindings), size);
  }
  return bindings;
}
