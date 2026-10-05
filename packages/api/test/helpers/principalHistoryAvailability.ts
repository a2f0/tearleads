import { expect } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalHistoryProgress,
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { clearPrincipalPolicySignatureCaches } from "@tearleads/crypto/principal-policy-test-fixtures";
import { bytesToBase64 } from "@tearleads/encoding";
import { PrincipalPolicyBundleResponseSchema } from "@tearleads/validators/response";
import { MAX_MULTIPART_BLOB_PART_BYTES } from "@tearleads/validators/util";
import { and, count, desc, eq } from "drizzle-orm";
import { createRequestLifetimeBindings } from "../../src/middleware/requestLifetime";
import { routeApp } from "../../src/routeApp";
import { parseOrganizationAuthorityDescriptor } from "../../src/workflows/organizations/organizationAuthorityDescriptor";
import { clearProjectionDirectoryBindingsCache } from "../../src/workflows/principals/projectionDirectoryBindings";
import { clearStoredPolicySnapshotCache } from "../../src/workflows/principals/snapshotVerificationCache";
import {
  COLD_DOCUMENT_TEXT,
  coldRematerializeEncryptedDocument,
  createEncryptedColdDocument,
} from "./coldSdkRematerialization";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "./keyingWriterProjectionKit";
import { seedLongPrincipalHistory } from "./longPrincipalHistory";
import {
  getPolicy,
  registerAndAuthenticate,
} from "./principalPolicyReadFixtures";
import { recoverRegisteredRootKek } from "./registeredRootKek";
import {
  grantRootThroughRotatedReadGroup,
  rotateRootGroupMembership,
} from "./rotatedReadGroupGrant";
import { clearAccessManifestVerificationMarkers } from "./verificationMarkers";

// Both chains really contain every version from genesis; no forged high head
// or shortened prefix can stand in for the cold recovery availability claim.
export async function assertPrincipalHistoryAvailability(
  throughVersion: number,
  onProgress: (stage: string) => void = () => {},
): Promise<void> {
  const owner = createTestUser();
  const removed = createTestUser();
  await registerAndAuthenticate(owner, removed);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  const document = await createEncryptedColdDocument({
    containerId: root.kekState.containerId,
    organizationId,
    owner,
  });
  const granted = await grantRootThroughRotatedReadGroup({
    actor: owner,
    reader: removed,
    root,
  });
  const group = PrincipalPolicyBundleResponseSchema.parse(
    await (await getPolicy(owner, "group", granted.groupId)).json(),
  );
  const groupHead = await seedLongPrincipalHistory({
    actor: owner,
    policy: group,
    throughVersion,
  });
  const organization = PrincipalPolicyBundleResponseSchema.parse(
    await (await getPolicy(owner, "organization", organizationId)).json(),
  );
  const directory = parseOrganizationAuthorityDescriptor(
    organization.currentPayload.ciphertext,
  );
  if (!directory) throw new Error("Expected organization directory");
  const groupHeads = directory.groupHeads.map((head) =>
    head.principalId === granted.groupId
      ? {
          ...head,
          version: groupHead.version,
          stateHash: groupHead.stateHash,
        }
      : head,
  );
  // The group advances first; the subsequent directory history repeatedly
  // cites that same complete group chain. These are valid, unchanged policies.
  await seedLongPrincipalHistory({
    actor: owner,
    policy: organization,
    throughVersion,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(JSON.stringify({ ...directory, groupHeads })),
    ),
  });
  onProgress("seeded");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: MAX_MULTIPART_BLOB_PART_BYTES,
    fetch: (request, server) =>
      routeApp.fetch(request, createRequestLifetimeBindings(request, server)),
  });
  let requestBytes = 0;
  const transport = async (path: string, init: RequestInit) => {
    if (typeof init.body !== "string")
      throw new Error("Expected JSON policy commit");
    requestBytes = new TextEncoder().encode(init.body).byteLength;
    expect(requestBytes).toBeLessThan(200_000);
    return fetch(new URL(path, server.url), init);
  };
  let rotated: Awaited<ReturnType<typeof rotateRootGroupMembership>>;
  try {
    rotated = await rotateRootGroupMembership({
      actor: owner,
      request: transport,
      groupId: granted.groupId,
      removedMemberUserId: removed.userId,
      root: granted.root,
    });
  } finally {
    await server.stop(true);
  }
  expect(requestBytes).toBeGreaterThan(0);
  expect(rotated.plaintextKek).not.toEqual(granted.root.plaintextKek);
  for (const [kind, id] of [
    ["group", granted.groupId],
    ["organization", organizationId],
  ] as const) {
    const scope = and(
      eq(principalStates.principalType, kind),
      eq(principalStates.principalId, id),
    );
    const [head] = await db
      .select()
      .from(principalStates)
      .where(scope)
      .orderBy(desc(principalStates.version))
      .limit(1);
    const [history] = await db
      .select({ count: count() })
      .from(principalStates)
      .where(scope);
    expect(head?.version).toBe(throughVersion + 1);
    expect(history?.count).toBe(throughVersion + 1);
    if (!head) throw new Error("Missing committed principal head");
    if (kind === "group") {
      expect(head.keyEpoch).toBe(group.currentState.keyEpoch + 1);
      for (const table of [
        principalMembershipProjection,
        principalMemberEnvelopes,
      ]) {
        const removedRows = await db
          .select({ userId: table.userId })
          .from(table)
          .where(
            and(
              eq(table.principalType, kind),
              eq(table.principalId, id),
              eq(table.stateHash, head.stateHash),
              eq(table.userId, removed.userId),
            ),
          );
        expect(removedRows).toEqual([]);
      }
    }
  }
  onProgress("revocation committed");

  const denied = await routeApp.request(
    `/documents/${document.documentId}/writer-projection`,
    {
      headers: { Authorization: `Bearer ${removed.token}` },
    },
  );
  expect(denied.status).toBe(403);
  // Discard durable verification hints. The recovery helper creates an empty
  // client database and fetches current policy/key material from the server.
  await clearAccessManifestVerificationMarkers();
  clearPrincipalPolicySignatureCaches();
  clearStoredPolicySnapshotCache();
  await db.delete(principalHistoryProgress);
  clearProjectionDirectoryBindingsCache();
  const coldServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: MAX_MULTIPART_BLOB_PART_BYTES,
    fetch: (request, server) =>
      routeApp.fetch(request, createRequestLifetimeBindings(request, server)),
  });
  const coldClient = new ApiClient(coldServer.url.origin);
  coldClient.setAuthToken(owner.token);
  try {
    const recovered = await coldRematerializeEncryptedDocument({
      apiClient: coldClient,
      documentId: document.documentId,
      organizationId,
      owner,
      reader: owner,
    });
    expect(recovered.policyFetchCount).toBeGreaterThan(0);
    expect(recovered.recoveredText).toBe(COLD_DOCUMENT_TEXT);
    expect(recovered.updateIds).toContain(document.updateId);
    onProgress("cold recovery complete");
  } finally {
    coldClient.clearWriterProjectionCaches();
    await coldServer.stop(true);
  }
}
