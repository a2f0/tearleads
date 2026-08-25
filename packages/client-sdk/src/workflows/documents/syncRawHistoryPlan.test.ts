import { expect, test } from "bun:test";
import { isDocumentSyncRequest } from "@symcrypt/validators/request";
import {
  createPreparedUpdate,
  createSyncFixture,
} from "../../../test/helpers/documentFixtures";
import { buildDocumentSyncPlan } from "./syncPlanIdentity";

test("buildDocumentSyncPlan creates an explicit raw-history pull", async () => {
  const { author, createResponse } = await createSyncFixture();
  const plan = await buildDocumentSyncPlan({
    author,
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    historyMode: "raw",
    localVersionVector: null,
  });

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  expect(plan.request.historyMode).toBe("raw");
  expect(plan.request.outgoingUpdates).toEqual([]);
  expect(plan.request.authorizingContainerPathRefs).toBeUndefined();
  expect(plan.request.contentKeyBundle).toBeUndefined();
});

test("buildDocumentSyncPlan rejects outgoing updates in raw-history mode", async () => {
  const { author, createResponse } = await createSyncFixture();

  await expect(
    buildDocumentSyncPlan({
      author,
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: createResponse.accessManifest,
      historyMode: "raw",
      localVersionVector: null,
      outgoingUpdates: [await createPreparedUpdate()],
    }),
  ).rejects.toThrow("raw-history sync must be read-only");
});

test("buildDocumentSyncPlan rejects a non-null raw-history frontier", async () => {
  const { author, createResponse } = await createSyncFixture();

  await expect(
    buildDocumentSyncPlan({
      author,
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: createResponse.accessManifest,
      historyMode: "raw",
      localVersionVector: "{}",
    }),
  ).rejects.toThrow("raw-history sync must start from a null version vector");
});
