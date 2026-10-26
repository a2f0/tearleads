import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { buildMaterializedContainerRekeyPlan } from "@tearleads/client-sdk";
import { createTestUser } from "@tearleads/test-utils";
import { ContainerWriterProjectionWireResponseSchema } from "@tearleads/validators/response";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { createHeldManifestCitations } from "../../../test/helpers/heldManifestCitations";
import { createOwnedTree } from "../../../test/helpers/ownedContainerTree";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { routeApp } from "../../routeApp";

test("cited manifest projections verify rotations while hints never grant access", async () => {
  const tree = await createOwnedTree(0);
  await tree.rotateRoot();
  const device = await createAncestorSdkContext(
    tree.owner,
    tree.organizationId,
  );
  const samples: { hint: string | null; served: number; omitted: number }[] =
    [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const response = await routeApp.fetch(request);
      if (
        response.ok &&
        new URL(request.url).pathname.endsWith("/writer-projection")
      ) {
        const wire = ContainerWriterProjectionWireResponseSchema.parse(
          await response.clone().json(),
        );
        samples.push({
          hint: request.headers.get("x-known-manifests"),
          served: Object.keys(wire.bundles).length,
          omitted: wire.omittedBundles.length,
        });
      }
      return response;
    },
  });
  const client = new ApiClient(server.url.origin);
  client.setAuthToken(tree.owner.token);
  const held = createHeldManifestCitations();
  client.setVerifiedManifestCitations(held.citations);
  const read = async () => {
    client.clearWriterProjectionCaches();
    const projection = await client.getContainerWriterProjection(tree.rootId);
    if (!projection) throw new Error("Expected root projection");
    await buildMaterializedContainerRekeyPlan({
      ...device.common,
      previousProjection: projection,
    });
    held.holdContainer(projection);
    return projection;
  };
  try {
    const first = await read();
    const repeated = await read();
    expect(repeated).toEqual(first);
    expect(samples[0]).toMatchObject({ hint: null, omitted: 0 });
    expect(samples[0]?.served).toBeGreaterThan(1);
    // Every bundle the device verified is cited, so none travels again.
    expect(samples[1]).toMatchObject({
      served: 0,
      omitted: samples[0]?.served,
    });
    await tree.rotateRoot();
    const next = await read();
    expect(next.containerKeks[0]?.containerKeyEpoch).toBe(
      (first.containerKeks[0]?.containerKeyEpoch ?? 0) + 1,
    );
    // Only the rotation's new head travels; the rest of the lineage is held.
    expect(samples[2]).toMatchObject({
      served: 1,
      omitted: samples[0]?.served,
    });
    expect(next.containerKeks[0]?.containerManifestHistory).toHaveLength(2);
    const hint = samples[2]?.hint;
    if (!hint) throw new Error("Expected known-manifest hint");
    const outsider = createTestUser();
    await registerAndAuthenticate(outsider);
    expect(
      (
        await routeApp.request(`/containers/${tree.rootId}/writer-projection`, {
          headers: {
            Authorization: `Bearer ${outsider.token}`,
            "x-known-manifests": hint,
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await routeApp.request(`/containers/${tree.rootId}/writer-projection`, {
          headers: {
            Authorization: `Bearer ${tree.owner.token}`,
            "x-known-manifests": "not-a-manifest-hash",
          },
        })
      ).status,
    ).toBe(400);
  } finally {
    server.stop(true);
    device.close();
    tree.close();
  }
}, 120_000);
