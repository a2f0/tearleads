import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestUser } from "@tearleads/bob-and-alice";
import { buildMaterializedContainerRekeyPlan } from "@tearleads/client-sdk";
import { ContainerWriterProjectionResponseSchema } from "@tearleads/validators/response";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { createOwnedTree } from "../../../test/helpers/ownedContainerTree";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { routeApp } from "../../routeApp";

test("incremental manifest projections verify rotations while hints never grant access", async () => {
  const tree = await createOwnedTree(0);
  await tree.rotateRoot();
  const device = await createAncestorSdkContext(
    tree.owner,
    tree.organizationId,
  );
  const samples: { hint: string; histories: number; omitted: number }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const response = await routeApp.fetch(request);
      if (
        response.ok &&
        new URL(request.url).pathname.endsWith("/writer-projection")
      ) {
        const wire = ContainerWriterProjectionResponseSchema.parse(
          await response.clone().json(),
        );
        samples.push({
          hint: request.headers.get("x-projection-history") ?? "[]",
          histories: wire.containerKeks.reduce(
            (count, kek) => count + kek.containerManifestHistory.length,
            0,
          ),
          omitted: wire.historyPrefixes?.length ?? 0,
        });
      }
      return response;
    },
  });
  const client = new ApiClient(server.url.origin);
  client.setAuthToken(tree.owner.token);
  const read = async () => {
    client.clearWriterProjectionCaches();
    const projection = await client.getContainerWriterProjection(tree.rootId);
    if (!projection) throw new Error("Expected root projection");
    await buildMaterializedContainerRekeyPlan({
      ...device.common,
      previousProjection: projection,
    });
    return projection;
  };
  try {
    const first = await read();
    const repeated = await read();
    expect(repeated.containerKeks).toEqual(first.containerKeks);
    expect(samples[0]?.histories).toBeGreaterThan(0);
    expect(samples[1]?.histories).toBe(0);
    await tree.rotateRoot();
    const next = await read();
    expect(next.containerKeks[0]?.containerKeyEpoch).toBe(
      (first.containerKeks[0]?.containerKeyEpoch ?? 0) + 1,
    );
    expect(samples[2]?.histories).toBe(1);
    expect(next.containerKeks[0]?.containerManifestHistory).toHaveLength(2);
    const hint = samples[2]?.hint;
    if (!hint) throw new Error("Expected exact prefix hint");
    const outsider = createTestUser();
    await registerAndAuthenticate(outsider);
    expect(
      (
        await routeApp.request(`/containers/${tree.rootId}/writer-projection`, {
          headers: {
            Authorization: `Bearer ${outsider.token}`,
            "x-projection-history": hint,
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await routeApp.request(`/containers/${tree.rootId}/writer-projection`, {
          headers: {
            Authorization: `Bearer ${tree.owner.token}`,
            "x-projection-history": "%invalid",
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
