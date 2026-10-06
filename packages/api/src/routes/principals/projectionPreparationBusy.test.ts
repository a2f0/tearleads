import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalHistoryIndexNodes,
  principalHistoryProgress,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { clearPrincipalPolicySignatureCaches } from "@tearleads/crypto/principal-policy-test-fixtures";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { clearAccessManifestVerificationMarkers } from "../../../test/helpers/verificationMarkers";
import { createApiErrorHandler } from "../../diagnostics/errorHandler";
import { createRouteApp } from "../../routeApp";
import { schedulePrincipalHistoryPreparation } from "../../workflows/principals/principalHistoryScheduler";
import { clearProjectionDirectoryBindingsCache } from "../../workflows/principals/projectionDirectoryBindings";
import { clearStoredPolicySnapshotCache } from "../../workflows/principals/snapshotVerificationCache";

test.each(["container", "document"] as const)(
  "%s projection preserves preparation saturation as 503 without an error capture",
  async (kind) => {
    const owner = createTestUser();
    await registerAndAuthenticate(owner);
    const root = await bootstrapRoot(owner);
    const objectId =
      kind === "container"
        ? root.kekState.containerId
        : (await createDocument({ owner, root })).id;
    const policy = root.principalPolicies[0];
    if (!policy) throw new Error("Missing fixture principal");
    await clearAccessManifestVerificationMarkers();
    await db.delete(principalHistoryProgress);
    await db.delete(principalHistoryIndexNodes);
    clearPrincipalPolicySignatureCaches();
    clearStoredPolicySnapshotCache();
    clearProjectionDirectoryBindingsCache();

    const gate = Promise.withResolvers<void>();
    const waiting = Array.from({ length: 66 }, (_, index) =>
      schedulePrincipalHistoryPreparation(
        db,
        {
          ...policy.state,
          principalId: crypto.randomUUID(),
        },
        () => (index < 2 ? gate.promise : Promise.resolve()),
      ).catch((error: unknown) => error),
    );
    const captured: unknown[] = [];
    const app = createRouteApp({});
    app.onError(createApiErrorHandler((error) => captured.push(error)));
    const request = () =>
      app.request(`/${kind}s/${objectId}/writer-projection`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
    try {
      const response = await request();
      expect(response.status, await response.clone().text()).toBe(503);
      expect(await response.json()).toEqual({
        error: "Principal history preparation is busy; retry later",
      });
      expect(captured).toEqual([]);
    } finally {
      gate.resolve();
      await Promise.all(waiting);
    }
    expect([200, 202]).toContain((await request()).status);
    expect(captured).toEqual([]);
  },
  15_000,
);
