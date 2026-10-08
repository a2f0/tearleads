import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestUser } from "@tearleads/bob-and-alice";
import { createRemoteContainer } from "@tearleads/client-sdk";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { PrincipalPolicyBundleResponseSchema } from "@tearleads/validators/response";
import {
  documentAuthor,
  trustedResolver,
} from "../../../test/helpers/coldSdkRematerialization";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { seedLongPrincipalHistory } from "../../../test/helpers/longPrincipalHistory";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { createPagedColdPolicyWarmer } from "../../../test/helpers/pagedColdPolicyWarmer";
import { startPrincipalHistoryHttpProbe } from "../../../test/helpers/principalHistoryHttpProbe";
import {
  getPolicy,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { parseOrganizationAuthorityDescriptor } from "../../workflows/organizations/organizationAuthorityDescriptor";

test("a real stale create recovers signed pages and commits a rebuilt request with the new head", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const groupId = root.principalPolicies[0]?.principalId;
  if (!groupId) throw new Error("Missing Admins");
  const group = PrincipalPolicyBundleResponseSchema.parse(
    await (await getPolicy(owner, "group", groupId)).json(),
  );
  const organization = PrincipalPolicyBundleResponseSchema.parse(
    await (await getPolicy(owner, "organization", organizationId)).json(),
  );
  const directory = parseOrganizationAuthorityDescriptor(
    organization.currentPayload.ciphertext,
  );
  if (!directory) throw new Error("Missing directory");
  const server = startPrincipalHistoryHttpProbe();
  const sqlite = await createTestExecSql("real-stale-create-retry");
  const apiClient = new ApiClient(server.url.origin);
  apiClient.setAuthToken(owner.token);
  apiClient.getCurrentPrincipalPolicy = async () => {
    throw new Error("Full policy API is forbidden");
  };
  const resolveTrustedUserIdentity = trustedResolver(owner);
  const paged = createPagedColdPolicyWarmer({
    apiClient,
    execSql: sqlite.execSql,
    resolveTrustedUserIdentity,
    onResolve: () => {},
  });
  const requests: { principalId: unknown; version: unknown }[][] = [];
  const statuses: (number | null)[] = [];
  const submit = apiClient.createContainerResult.bind(apiClient);
  apiClient.createContainerResult = async (request, options) => {
    requests.push(
      request.principalPolicies.map((policy) => ({
        principalId: Reflect.get(policy, "principalId"),
        version: Reflect.get(policy, "version"),
      })),
    );
    if (requests.length === 1) {
      const head = await seedLongPrincipalHistory({
        actor: owner,
        policy: group,
        throughVersion: 2,
      });
      const groupHeads = directory.groupHeads.map((reference) =>
        reference.principalId === groupId
          ? { ...reference, version: head.version, stateHash: head.stateHash }
          : reference,
      );
      await seedLongPrincipalHistory({
        actor: owner,
        policy: organization,
        throughVersion: 2,
        payloadCiphertext: bytesToBase64(
          new TextEncoder().encode(
            JSON.stringify({ ...directory, groupHeads }),
          ),
        ),
      });
    }
    const result = await submit(request, options);
    statuses.push(result.ok ? 200 : result.status);
    return result;
  };
  try {
    const result = await createRemoteContainer({
      apiClient,
      author: documentAuthor(owner, organizationId),
      execSql: sqlite.execSql,
      parentContainerId: root.kekState.containerId,
      parentSecretKey: owner.kem.secretKey,
      resolveProjectionUserKey: resolveTrustedUserIdentity,
      resolveTrustedUserIdentity,
      reportSecurityIncident: async (incident) => {
        throw new Error(JSON.stringify(incident));
      },
      warmReferencedPrincipalPolicies: paged.warmer,
    });
    expect(result).not.toBeNull();
    expect(statuses).toEqual([409, 200]);
    expect(requests[0]).toContainEqual({ principalId: groupId, version: 1 });
    expect(requests[1]).toContainEqual({ principalId: groupId, version: 2 });
  } finally {
    paged.dispose();
    sqlite.close();
    await server.stop();
  }
}, 30_000);
