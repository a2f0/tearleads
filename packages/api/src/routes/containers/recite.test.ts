import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerKeyEpochs,
  containerKeyWraps,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  isContainerReciteResponse,
  isContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  postRecite as post,
  buildReciteRequest as request,
  createReciteScenario as scenario,
} from "../../../test/helpers/containerRecite";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("re-citing an empty child advances its manifest and preserves every KEK row", async () => {
  const { owner, root, child } = await scenario();
  const path = [root.bundle, child.accessManifest];
  const epochsBefore = await db
    .select()
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.containerId, child.containerId));
  const loadWraps = () =>
    db
      .select()
      .from(containerKeyWraps)
      .where(
        eq(
          containerKeyWraps.containerKeyEpochId,
          child.containerKek.containerKeyEpochId,
        ),
      );
  const wrapsBefore = await loadWraps();
  const signed = await request({ path, signer: owner });
  const response = await post(child.containerId, owner, signed);
  expect(response.status, await response.clone().text()).toBe(200);
  const body: unknown = await response.json();
  if (!isContainerReciteResponse(body))
    throw new Error("Expected recite response");
  expect(body.accessManifest.manifestHash).toBe(signed.expectedManifestHash);
  expect(body.accessManifest.state).toMatchObject({
    directGrants: [],
    containerKeyEpochId: child.containerKek.containerKeyEpochId,
  });
  expect(
    await db
      .select()
      .from(containerKeyEpochs)
      .where(eq(containerKeyEpochs.containerId, child.containerId)),
  ).toEqual(epochsBefore);
  expect(await loadWraps()).toEqual(wrapsBefore);
  const projectionResponse = await routeApp.request(
    `/containers/${child.containerId}/writer-projection`,
    {
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(
    projectionResponse.status,
    await projectionResponse.clone().text(),
  ).toBe(200);
  const projection: unknown = await projectionResponse.json();
  if (!isContainerWriterProjectionResponse(projection))
    throw new Error("Expected projection");
  expect(projection.path.at(-1)?.manifestHash).toBe(
    signed.expectedManifestHash,
  );
  const replay = await post(child.containerId, owner, signed);
  expect(replay.status).toBe(409);
});

test("recitation rejects missing ancestor citations and changed key epochs", async () => {
  const { owner, root, child } = await scenario();
  for (const options of [
    { omitAncestor: true },
    { keyEpochId: "changed-key" },
  ]) {
    const response = await post(
      child.containerId,
      owner,
      await request({
        ...options,
        path: [root.bundle, child.accessManifest],
        signer: owner,
      }),
    );
    expect(response.status, await response.clone().text()).toBe(409);
  }
});

test("a signer without inherited admin authority cannot recite a child", async () => {
  const { root, child } = await scenario();
  const stranger = createTestUser();
  await registerUser(stranger);
  await authenticate(stranger);
  const response = await post(
    child.containerId,
    stranger,
    await request({
      path: [root.bundle, child.accessManifest],
      signer: stranger,
    }),
  );
  expect(response.status, await response.clone().text()).toBe(403);
});

test("a child re-cites an advanced ancestor and rejects the old authorizing path", async () => {
  const { owner, root, child } = await scenario();
  const rootResponse = await post(
    root.kekState.containerId,
    owner,
    await request({ path: [root.bundle], signer: owner }),
  );
  expect(rootResponse.status).toBe(200);
  const advanced: unknown = await rootResponse.json();
  if (!isContainerReciteResponse(advanced))
    throw new Error("Expected advanced root");
  const stale = await post(
    child.containerId,
    owner,
    await request({
      path: [root.bundle, child.accessManifest],
      signer: owner,
    }),
  );
  expect(stale.status).toBe(409);
  const current = await post(
    child.containerId,
    owner,
    await request({
      path: [advanced.accessManifest, child.accessManifest],
      signer: owner,
    }),
  );
  expect(current.status, await current.clone().text()).toBe(200);
});
