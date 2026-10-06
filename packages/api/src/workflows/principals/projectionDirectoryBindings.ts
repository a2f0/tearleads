import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  computePrincipalStatePayloadCiphertextHash,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { readLatestPrincipalDirectoryBinding } from "../../access/read/principalDirectoryBindings";
import {
  getPrincipalStatePayloadForState,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { ByteBudgetCache } from "../../utils/byteBudgetCache";
import { parseOrganizationAuthorityDescriptor } from "../organizations/organizationAuthorityDescriptor";
import { PrincipalPolicyError } from "./shared";

type DirectoryPayload = NonNullable<
  Awaited<ReturnType<typeof getPrincipalStatePayloadForState>>
>;
interface DirectoryBindings {
  latest: Map<string, ReferencedPrincipalHead>;
  adminGroupIds: Set<string>;
  bindingPayloadByGroupState: Map<string, DirectoryPayload>;
}

// Immutable signed heads and the requested group set bind each memo entry.
// Current object authorization always precedes this proof-only lookup.
const bindingsByHead = new ByteBudgetCache<DirectoryBindings>(32 * 1024 * 1024);

/** Drop only process-local derived state, including for cold-read probes. */
export function clearProjectionDirectoryBindingsCache(): void {
  bindingsByHead.clear();
}

async function readDirectory(input: {
  executor: DatabaseSession;
  organizationId: string;
  stateHash: string;
  payloadCiphertextHash: string;
}) {
  const payload = await getPrincipalStatePayloadForState(
    "organization",
    input.organizationId,
    input.stateHash,
    input.executor,
  );
  if (!payload)
    throw new PrincipalPolicyError("Projection directory history missing", 409);
  const hash = await computePrincipalStatePayloadCiphertextHash(
    payload.ciphertext,
  );
  if (hash !== payload.ciphertextHash || hash !== input.payloadCiphertextHash)
    throw new PrincipalPolicyError(
      "Projection directory payload hash mismatch",
      409,
    );
  const directory = parseOrganizationAuthorityDescriptor(payload.ciphertext);
  if (!directory || directory.organizationId !== input.organizationId)
    throw new PrincipalPolicyError(
      "Projection directory organization mismatch",
      409,
    );
  return { directory, payload };
}

/** Read only the current directory and indexed bindings for deleted groups. */
export async function loadProjectionDirectoryBindings(input: {
  executor: DatabaseSession;
  organization: StoredPrincipalState;
  groupIds: readonly string[];
}): Promise<DirectoryBindings> {
  const organizationId = input.organization.principalId;
  const key = JSON.stringify([
    organizationId,
    input.organization.stateHash,
    [...new Set(input.groupIds)].sort(),
  ]);
  const cached = bindingsByHead.get(key);
  if (cached) return structuredClone(cached);
  const current = await readDirectory({
    executor: input.executor,
    organizationId,
    stateHash: input.organization.stateHash,
    payloadCiphertextHash: input.organization.payloadCiphertextHash,
  });
  const directories = new Map([
    [
      `${input.organization.stateHash}:${input.organization.payloadCiphertextHash}`,
      current,
    ],
  ]);
  const bindings: DirectoryBindings = {
    latest: new Map(),
    adminGroupIds: new Set([current.directory.adminGroupId]),
    bindingPayloadByGroupState: new Map(),
  };
  const needed = new Set([...input.groupIds, current.directory.adminGroupId]);
  for (const groupId of needed) {
    let source = current;
    let head = source.directory.groupHeads.find(
      (candidate) => candidate.principalId === groupId,
    );
    if (!head) {
      const row = await readLatestPrincipalDirectoryBinding({
        executor: input.executor,
        organizationId,
        groupId,
        throughVersion: input.organization.version,
      });
      if (!row?.payloadCiphertextHash)
        throw new PrincipalPolicyError(
          "Projection group directory binding missing",
          409,
        );
      const directoryKey = `${row.organizationStateHash}:${row.payloadCiphertextHash}`;
      const retained = directories.get(directoryKey);
      source =
        retained ??
        (await readDirectory({
          executor: input.executor,
          organizationId,
          stateHash: row.organizationStateHash,
          payloadCiphertextHash: row.payloadCiphertextHash,
        }));
      directories.set(directoryKey, source);
      head = source.directory.groupHeads.find(
        (candidate) => candidate.principalId === groupId,
      );
      if (
        !head ||
        head.stateHash !== row.groupStateHash ||
        head.version !== row.groupVersion
      )
        throw new PrincipalPolicyError(
          "Projection group directory binding differs",
          409,
        );
    }
    bindings.latest.set(groupId, head);
    bindings.bindingPayloadByGroupState.set(head.stateHash, source.payload);
    bindings.adminGroupIds.add(source.directory.adminGroupId);
    needed.add(source.directory.adminGroupId);
  }
  bindingsByHead.set(key, structuredClone(bindings), bindingBytes(bindings));
  return bindings;
}

function bindingBytes(bindings: DirectoryBindings): number {
  return (
    JSON.stringify({
      heads: [...bindings.latest.values()],
      admins: [...bindings.adminGroupIds],
    }).length *
      4 +
    [...new Set(bindings.bindingPayloadByGroupState.values())].reduce(
      (total, payload) => total + payload.ciphertext.length * 4 + 512,
      0,
    ) +
    bindings.latest.size * 256
  );
}
