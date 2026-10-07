import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalHistoryIndexNodes,
  principalHistoryProgress,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { recoverProjectionPolicyHistory } from "@tearleads/client-sdk";
import { principalPolicyMatchesReference } from "@tearleads/crypto";
import { clearPrincipalPolicySignatureCaches } from "@tearleads/crypto/principal-policy-test-fixtures";
import { createTestExecSql } from "@tearleads/test-utils";
import { PrincipalPolicyBundleResponseSchema } from "@tearleads/validators/response";
import { trustedResolver } from "../../../test/helpers/coldSdkRematerialization";
import { seedLongPrincipalHistory } from "../../../test/helpers/longPrincipalHistory";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { startPrincipalHistoryHttpProbe } from "../../../test/helpers/principalHistoryHttpProbe";
import {
  buildOrganizationGroupDeletionRequest,
  getDefaultOrganizationId,
} from "../../../test/helpers/principalPolicy";
import {
  getPolicy,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { clearStoredPolicySnapshotCache } from "../../workflows/principals/snapshotVerificationCache";

test("a fresh SDK recovers deleted-group display sources over bounded real HTTP pages", async () => {
  const actor = createTestUser();
  await registerAndAuthenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const probe = startPrincipalHistoryHttpProbe();
  const sqlite = await createTestExecSql("org-history-http");
  const client = new ApiClient(probe.url.origin);
  client.setAuthToken(actor.token);
  try {
    const groupId = crypto.randomUUID();
    const created = await client.createOrganizationGroupResult(
      organizationId,
      await createGroupRequest({
        actor,
        groupId,
        name: "Historical group",
        includeActorAsAdmin: false,
      }),
    );
    expect(created.ok).toBe(true);
    const policy = PrincipalPolicyBundleResponseSchema.parse(
      await (await getPolicy(actor, "organization", organizationId)).json(),
    );
    await seedLongPrincipalHistory({ actor, policy, throughVersion: 65 });
    const target = await getCurrentPrincipalState(
      "organization",
      organizationId,
      db,
    );
    if (!target) throw new Error("Missing directory head");
    const deleted = await client.deleteOrganizationGroupResult(
      organizationId,
      groupId,
      await buildOrganizationGroupDeletionRequest({
        actor,
        groupId,
        organizationId,
      }),
    );
    expect(deleted.ok).toBe(true);
    await db.delete(principalHistoryProgress);
    await db.delete(principalHistoryIndexNodes);
    clearPrincipalPolicySignatureCaches();
    clearStoredPolicySnapshotCache();
    const result = await client.getOrganizationPolicyHistoryResult(
      organizationId,
      target.stateHash,
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.data.evidence.organizationPayloads).toHaveLength(33);
    const reference = result.data.evidence.groups.find(
      ({ head }) => head.principalId === groupId,
    )?.head;
    if (!reference) throw new Error("Deleted group source is missing");
    const recovered = await recoverProjectionPolicyHistory({
      apiClient: client,
      execSql: sqlite.execSql,
      organizationId,
      evidence: result.data.evidence,
      references: [
        reference,
        ...result.data.evidence.organizationPayloads.map(
          ({ reference }) => reference,
        ),
      ],
      protection: {
        localKey: new Uint8Array(32).fill(7),
        context: "org-history-http",
      },
      stillCurrent: () => true,
      resolveTrustedUserIdentity: trustedResolver(actor),
    });
    expect(
      recovered.some((policy) =>
        principalPolicyMatchesReference({ policy, reference }),
      ),
    ).toBe(true);
    const older = await client.getOrganizationPolicyHistoryResult(
      organizationId,
      target.stateHash,
      { beforeVersion: 34 },
    );
    expect(older).toMatchObject({
      ok: true,
      data: {
        stateHash: target.stateHash,
        beforeVersion: 34,
        nextBeforeVersion: 2,
      },
    });
    expect(probe.metrics.deadlineFailures).toBe(0);
    expect(probe.metrics.maximumRequestMs).toBeLessThan(15_000);
    expect(probe.metrics.maximumResponseBytes).toBeLessThanOrEqual(384 * 1024);
    expect(
      probe.metrics.maximumDatabaseStatementsPerRequest,
    ).toBeLessThanOrEqual(300);
    expect(probe.metrics.requests).toBeLessThanOrEqual(20);
  } finally {
    await probe.stop();
    sqlite.close();
    console.info(
      "organization-history HTTP metrics",
      JSON.stringify(probe.metrics),
    );
  }
}, 60_000);
