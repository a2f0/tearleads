import { expect } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalHistoryIndexNodes,
  principalHistoryProgress,
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { clearPrincipalPolicySignatureCaches } from "@tearleads/crypto/principal-policy-test-fixtures";
import { bytesToBase64 } from "@tearleads/encoding";
import { commitOrganizationGroupPolicyOperation } from "@tearleads/validators/operation";
import { PrincipalPolicyBundleResponseSchema } from "@tearleads/validators/response";
import { and, count, desc, eq } from "drizzle-orm";
import { parseOrganizationAuthorityDescriptor } from "../../src/workflows/organizations/organizationAuthorityDescriptor";
import { clearProjectionDirectoryBindingsCache } from "../../src/workflows/principals/projectionDirectoryBindings";
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
  requirePrincipalHistoryProbeDatabase,
  startPrincipalHistoryProbe,
} from "./principalHistoryProbeProcess";
import {
  getPolicy,
  registerAndAuthenticate,
} from "./principalPolicyReadFixtures";
import { clearStoredPolicySnapshotCache } from "./principalSnapshotVerificationCache";
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
  requirePrincipalHistoryProbeDatabase();
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
  const server = await startPrincipalHistoryProbe(owner);
  let requestBytes = 0;
  let preparationResponses = 0;
  const transport = async (path: string, init: RequestInit) => {
    if (typeof init.body !== "string")
      throw new Error("Expected JSON policy commit");
    requestBytes = new TextEncoder().encode(init.body).byteLength;
    expect(requestBytes).toBeLessThan(200_000);
    // Request construction reads stored policy through test helpers. Discard
    // the verification hints that setup warmed before exercising HTTP work.
    // These clears affect only the parent in isolated mode. A new server starts
    // cold, then keeps process caches until the next explicit restart.
    await db.delete(principalHistoryProgress);
    await db.delete(principalHistoryIndexNodes);
    clearPrincipalPolicySignatureCaches();
    clearStoredPolicySnapshotCache();
    clearProjectionDirectoryBindingsCache();
    while (true) {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${server.token}`);
      const response = await fetch(new URL(path, server.url), {
        ...init,
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status !== 202) return response;
      expect(
        commitOrganizationGroupPolicyOperation.responses[202].safeParse(
          await response.json(),
        ).success,
      ).toBe(true);
      preparationResponses += 1;
      // This is a test's stuck-progress guard, not a protocol history ceiling.
      expect(preparationResponses).toBeLessThan(throughVersion * 4);
      for (const id of [granted.groupId, organizationId]) {
        const [head] = await db
          .select({ version: principalStates.version })
          .from(principalStates)
          .where(eq(principalStates.principalId, id))
          .orderBy(desc(principalStates.version))
          .limit(1);
        expect(head?.version).toBe(throughVersion);
      }
      if (preparationResponses === 1 && server.restart) {
        // Preserve the exact authored request and database, but lose all
        // process-local verification caches after one durable preparation page.
        const progress = await db
          .select()
          .from(principalHistoryProgress)
          .orderBy(principalHistoryProgress.id);
        expect(progress.length).toBeGreaterThan(0);
        await server.restart();
        expect(
          await db
            .select()
            .from(principalHistoryProgress)
            .orderBy(principalHistoryProgress.id),
        ).toEqual(progress);
        onProgress("server restarted after preparation");
      }
    }
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
    await server.stop();
    onProgress(`mutation HTTP metrics ${JSON.stringify(server.metrics)}`);
  }
  expect(server.metrics.deadlineFailures).toBe(0);
  expect(server.metrics.totalDatabaseStatements).toBeGreaterThan(0);
  expect(server.metrics.maximumDatabaseStatementsPerRequest).toBeLessThan(
    1_024,
  );
  expect(server.metrics.maximumResponseBytes).toBeLessThan(200_000);
  expect(requestBytes).toBeGreaterThan(0);
  expect(preparationResponses).toBeGreaterThan(0);
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

  const deniedServer = await startPrincipalHistoryProbe(removed);
  const deniedClient = new ApiClient(deniedServer.url.origin);
  deniedClient.setAuthToken(deniedServer.token);
  try {
    const denied = await deniedClient.getDocumentWriterProjectionResult(
      document.documentId,
      { reportErrors: false },
    );
    expect(denied.ok).toBe(false);
    if (denied.ok) throw new Error("Revoked reader retained document access");
    expect(denied.status).toBe(403);
  } finally {
    await deniedServer.stop();
    onProgress(
      `revoked reader HTTP metrics ${JSON.stringify(deniedServer.metrics)}`,
    );
  }
  expect(deniedServer.metrics.deadlineFailures).toBe(0);
  // Discard durable verification hints. The recovery helper creates an empty
  // client database and fetches current policy/key material from the server.
  await clearAccessManifestVerificationMarkers();
  clearPrincipalPolicySignatureCaches();
  clearStoredPolicySnapshotCache();
  await db.delete(principalHistoryProgress);
  await db.delete(principalHistoryIndexNodes);
  clearProjectionDirectoryBindingsCache();
  const coldServer = await startPrincipalHistoryProbe(owner);
  const coldClient = new ApiClient(coldServer.url.origin);
  coldClient.setAuthToken(coldServer.token);
  try {
    const recovered = await coldRematerializeEncryptedDocument({
      apiClient: coldClient,
      documentId: document.documentId,
      organizationId,
      owner,
      reader: owner,
      pagedPolicies: true,
    });
    expect(recovered.policyFetchCount).toBeGreaterThan(0);
    expect(recovered.recoveredText).toBe(COLD_DOCUMENT_TEXT);
    expect(recovered.updateIds).toContain(document.updateId);
    onProgress("cold recovery complete");
  } finally {
    coldClient.clearWriterProjectionCaches();
    await coldServer.stop();
    onProgress(`cold HTTP metrics ${JSON.stringify(coldServer.metrics)}`);
  }
  expect(coldServer.metrics.deadlineFailures).toBe(0);
  expect(coldServer.metrics.totalDatabaseStatements).toBeGreaterThan(0);
  expect(coldServer.metrics.maximumDatabaseStatementsPerRequest).toBeLessThan(
    1_024,
  );
  expect(coldServer.metrics.maximumResponseBytes).toBeLessThan(400_000);
}
