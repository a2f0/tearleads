import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { continuityDocuments, loadContinuityAssets } from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test.each(["missing", "different", "lost"] as const)(
  "seed resumes an already committed birth after a %s acknowledgement",
  async (fault) => {
    await initializeApiDatabase();
    let committed: string | undefined;
    let inject = false;
    let uploads = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/blobs/stages/multipart") uploads++;
        if (inject && path === "/documents" && request.method === "POST") {
          // Interrupt the retry at the next fixture after the first one finishes.
          if (committed) return new Response(null, { status: 503 });
          const response = await routeApp.fetch(request);
          if (!response.ok) return response;
          const body = await response.json();
          committed = body.id;
          if (fault === "lost") return new Response(null, { status: 503 });
          if (fault === "missing") delete body.initialSync;
          else
            body.initialSync.acceptedOutgoingUpdateIds = [crypto.randomUUID()];
          return Response.json(body, { status: response.status });
        }
        return routeApp.fetch(request);
      },
    });
    try {
      const apiBaseUrl = server.url.origin;
      const { seedPhrase, rootContainerId } =
        await registerCliTestAccount(apiBaseUrl);
      const { context, keyStore, output } = testContext({ apiBaseUrl });
      await keyStore.save("staging", seedPhrase);
      const seed = () => runCli(["seed", "--env", "staging"], context);
      inject = true;
      expect(await seed()).toBe(1);
      expect(committed).toBeDefined();
      if (fault !== "lost")
        expect(output.stderr.join(" ")).toContain("acknowledge");
      expect(uploads).toBe(0);
      expect(await seed()).toBe(1);
      expect(uploads).toBe(1);
      const { spec, readAttachment } = await loadContinuityAssets();
      const first = continuityDocuments(spec)[0];
      await onFreshDevice(
        { apiBaseUrl, rootContainerId, recoveryKey: seedPhrase },
        async (stores, sdk) => {
          expect(stores).toHaveLength(1);
          const snapshot = stores[0]?.getSnapshot();
          expect(snapshot?.documentId).toBe(committed);
          expect(snapshot?.structuredFields).toMatchObject(first?.fields ?? {});
          const avatar = snapshot?.attachments[0];
          if (!snapshot || !avatar) throw new Error("Missing committed avatar");
          const key = snapshot.attachmentStorageKeyBySlotId[avatar.slotId];
          expect(key).toBeDefined();
          expect(await sdk.blobs.store.readBytes(key ?? "")).toEqual(
            await readAttachment(avatar.name),
          );
        },
      );
    } finally {
      server.stop(true);
    }
  },
  60_000,
);
