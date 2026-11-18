import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { buildMaterializedContainerRekeyPlan } from "@tearleads/client-sdk";
import { createTestUser } from "@tearleads/test-utils";
import {
  ContainerWriterProjectionWireResponseSchema,
  PrincipalPolicyBundleResponseSchema,
} from "@tearleads/validators/response";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import {
  getPolicy,
  registerAndAuthenticateUsers,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { routeApp } from "../../routeApp";

test("the real SDK verifies a projection whose cited directory payload was refilled, and refuses a mismatched one", async () => {
  const owner = createTestUser();
  await registerAndAuthenticateUsers(owner);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const organizationId = Reflect.get(root.bundle.manifest, "organizationId");
  if (typeof organizationId !== "string")
    throw new Error("Missing organization");
  const organization = PrincipalPolicyBundleResponseSchema.parse(
    await (await getPolicy(owner, "organization", organizationId)).json(),
  );
  const cited = organization.currentState.stateHash;
  const served: { hint: string | null; omitted: number }[] = [];
  let tamper = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const response = await routeApp.fetch(request);
      if (
        !new URL(request.url).pathname.endsWith("/writer-projection") ||
        response.status !== 200
      )
        return response;
      const value = ContainerWriterProjectionWireResponseSchema.parse(
        await response.json(),
      );
      const payloads = value.policyEvidence.organizationPayloads;
      served.push({
        hint: request.headers.get("x-known-manifests"),
        omitted: payloads.filter(({ payload }) => payload === null).length,
      });
      if (tamper)
        // The omitted payload refills by state hash, but the reference now
        // names a key that state does not sign.
        for (const entry of payloads)
          if (entry.payload === null)
            entry.reference = {
              ...entry.reference,
              keyFingerprint: "0".repeat(64),
            };
      return Response.json(value);
    },
  });
  const client = new ApiClient(server.url.origin);
  client.setAuthToken(owner.token);
  client.setVerifiedManifestCitations({
    cite: async () => [
      {
        directoryState: organization.currentState,
        directoryPayload: organization.currentPayload,
      },
    ],
  });
  const device = await createAncestorSdkContext(owner, organizationId);
  const read = async () => {
    client.clearWriterProjectionCaches();
    const projection = await client.getContainerWriterProjection(
      root.kekState.containerId,
    );
    if (!projection) throw new Error("Missing projection");
    await buildMaterializedContainerRekeyPlan({
      ...device.common,
      previousProjection: projection,
    });
    return projection;
  };
  try {
    const projection = await read();
    expect(served[0]?.hint).toContain(`d:${cited}`);
    expect(served[0]?.omitted).toBe(1);
    expect(
      projection.policyEvidence.organizationPayloads.find(
        ({ reference }) => reference.stateHash === cited,
      )?.payload,
    ).toEqual(organization.currentPayload);

    tamper = true;
    // Verification still checks the refilled evidence: the directory's
    // reference must match the state the verified chain holds.
    await expect(read()).rejects.toThrow(
      "Public history citation differs from its verified entry",
    );
    expect(served.at(-1)?.omitted).toBe(1);
  } finally {
    device.close();
    await server.stop(true);
  }
});
