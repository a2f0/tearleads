import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { deriveStableDocumentId } from "@tearleads/client-sdk";
import { continuityDocuments, loadContinuityAssets } from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";
import { withSession } from "./session";

test("racing two first imports of the same tracker preserves exactly its fixture rows", async () => {
  await initializeApiDatabase();
  const firstMissing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let missing = 0;
  let trackerPath = "";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const response = await routeApp.fetch(request);
      if (
        new URL(request.url).pathname === trackerPath &&
        response.status === 404
      ) {
        missing++;
        firstMissing.resolve();
        if (missing === 2) release.resolve();
        await release.promise;
      }
      return response;
    },
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { seedPhrase, rootContainerId } =
      await registerCliTestAccount(apiBaseUrl);
    const device = { apiBaseUrl, rootContainerId, recoveryKey: seedPhrase };
    const { spec, datasetSha256 } = await loadContinuityAssets();
    const tracker = continuityDocuments(spec).find(
      (doc) => doc.kind === "weight",
    );
    if (!tracker?.rows?.length) throw new Error("Missing fixture tracker rows");
    const expectedRows = [...tracker.rows];
    const documentId = await withSession(device, async ({ sdk }) => {
      const key = sdk.identity.signingKeyPair?.signingPrivateKey;
      if (!key || !rootContainerId)
        throw new Error("Missing account root or keys");
      const localId = createHmac("sha256", key)
        .update(
          `tearleads.continuity/${rootContainerId}/${datasetSha256}/${tracker.key}`,
        )
        .digest("hex");
      return deriveStableDocumentId(localId);
    });
    trackerPath = `/documents/${documentId}/writer-projection`;
    const seed = async () => {
      const { context, keyStore } = testContext({ apiBaseUrl });
      await keyStore.save("staging", seedPhrase);
      return runCli(["seed", "--env", "staging"], context);
    };
    const first = seed().finally(release.resolve);
    await Promise.race([
      firstMissing.promise,
      first.then(() => {
        throw new Error("First importer never reached the missing tracker");
      }),
    ]);
    const results = await Promise.all([first, seed().finally(release.resolve)]);
    expect(missing).toBe(2);
    await onFreshDevice(device, async (stores) => {
      const trackers = stores
        .map((store) => store.getSnapshot())
        .filter((doc) => doc.documentKind === "weight");
      expect(trackers).toHaveLength(1);
      expect(trackers[0]?.documentId).toBe(documentId);
      expect(trackers[0]?.rows.map((row) => row.fields)).toEqual(expectedRows);
    });
    if (results.includes(1)) expect(await seed()).toBe(0);
  } finally {
    release.resolve();
    server.stop(true);
  }
}, 240_000);
