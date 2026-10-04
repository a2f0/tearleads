import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { buildMaterializedContainerRekeyPlan } from "@tearleads/client-sdk";
import {
  ContainerWriterProjectionResponseSchema,
  PrincipalPolicyBundleResponseSchema,
} from "@tearleads/validators/response";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import {
  getPolicy,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import {
  signPrincipalStateBundle,
  storePrincipalState,
} from "../../../test/helpers/principalState";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../access/write/principalMemberEnvelopes";
import { routeApp } from "../../routeApp";

test("real SDK admits verified prefixes, verifies suffixes and recovers cold without them", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
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
  let previous = organization.currentState;
  const advance = async () => {
    const successor = await signPrincipalStateBundle({
      ...previous,
      version: previous.version + 1,
      prevStateHash: previous.stateHash,
      payloadCiphertext: organization.currentPayload.ciphertext,
      members: organization.currentProjection.map(({ userId }) => ({ userId })),
      projection: organization.currentProjection,
      grants: organization.currentGrants,
      memberEnvelopes: organization.currentMemberEnvelopes.envelopes,
      signingPrivateKey: owner.signing.signingPrivateKey,
    });
    const stored = await storePrincipalState(successor, db);
    await db.transaction((tx) =>
      replaceCurrentPrincipalMemberEnvelopesInTransaction(
        {
          principalType: "organization",
          principalId: organizationId,
          stateHash: stored.stateHash,
          envelopes: organization.currentMemberEnvelopes.envelopes,
        },
        tx,
      ),
    );
    previous = { ...previous, ...successor.state, stateHash: stored.stateHash };
  };
  for (let index = 0; index < 32; index++) await advance();
  const samples: { bytes: number; hinted: boolean; omitted: number }[] = [];
  let tamper = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const response = await routeApp.fetch(request);
      if (
        !new URL(request.url).pathname.endsWith("/writer-projection") ||
        !response.ok
      )
        return response;
      const text = await response.clone().text();
      const value = ContainerWriterProjectionResponseSchema.parse(
        JSON.parse(text),
      );
      samples.push({
        bytes: new TextEncoder().encode(text).length,
        hinted: request.headers.has("x-projection-history"),
        omitted: value.historyPrefixes?.length ?? 0,
      });
      if (tamper) {
        if (!value.policyEvidence.organization)
          throw new Error("Missing policy evidence");
        value.policyEvidence.organization.currentState.signature = "forged";
        return Response.json(value);
      }
      return response;
    },
  });
  const client = new ApiClient(server.url.origin);
  client.setAuthToken(owner.token);
  const device = await createAncestorSdkContext(owner, organizationId);
  const cold = await createAncestorSdkContext(owner, organizationId);
  const read = async (apiClient: ApiClient, context = device) => {
    apiClient.clearWriterProjectionCaches();
    const projection = await apiClient.getContainerWriterProjection(
      root.kekState.containerId,
    );
    if (!projection) throw new Error("Missing projection");
    const plan = await buildMaterializedContainerRekeyPlan({
      ...context.common,
      previousProjection: projection,
    });
    return { projection, plan };
  };
  try {
    const first = await read(client);
    const repeated = await read(client);
    expect(repeated.projection.policyEvidence).toEqual(
      first.projection.policyEvidence,
    );
    expect(samples[0]?.hinted).toBe(false);
    expect(samples[1]?.hinted).toBe(true);
    expect(samples[1]?.omitted).toBeGreaterThan(0);
    expect(samples[1]?.bytes).toBeLessThan((samples[0]?.bytes ?? 0) / 2);
    await advance();
    const next = await read(client);
    expect(
      next.projection.policyEvidence.organization?.currentState.version,
    ).toBe(previous.version);
    expect(
      next.projection.policyEvidence.organization?.previousStates,
    ).toHaveLength(previous.version - 1);
    expect(samples[2]?.omitted).toBeGreaterThan(0);
    expect(samples[2]?.bytes).toBeLessThan((samples[0]?.bytes ?? 0) / 2);
    const freshClient = new ApiClient(server.url.origin);
    freshClient.setAuthToken(owner.token);
    const recovered = await read(freshClient, cold);
    expect(recovered.projection.policyEvidence).toEqual(
      next.projection.policyEvidence,
    );
    expect(samples[3]?.hinted).toBe(false);
    expect(samples[3]?.omitted).toBe(0);
    // Warm signature caches must never make a tampered successor acceptable.
    tamper = true;
    await expect(read(client)).rejects.toThrow();
    tamper = false;
    // Clearing auth scope drops history hints, including old pending admissions.
    client.setAuthToken(null);
    client.setAuthToken(owner.token);
    await read(client);
    expect(samples.at(-1)?.hinted).toBe(false);
    console.info(
      "Incremental policy projection bytes",
      JSON.stringify(samples),
    );
  } finally {
    server.stop(true);
    device.close();
    cold.close();
  }
}, 120_000);
