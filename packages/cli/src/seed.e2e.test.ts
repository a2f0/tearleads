import { expect, spyOn, test } from "bun:test";
import { createHmac } from "node:crypto";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import * as sdkModule from "@tearleads/client-sdk";
import {
  deriveStableDocumentId,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import {
  continuityDocuments,
  loadContinuityAssets,
  writeContinuityDocument,
} from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { publishSeedEdit } from "./seedAttachmentMetadata.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test("seed uploads the pinned dataset and a fresh device can read it", async () => {
  await initializeApiDatabase();
  let interruptUpload = true;
  let staleTarget = false;
  let legacyDownloads = false;
  let legacyByteReads = 0;
  let rebindAfterHydration: "blob" | "binding" | null = null;
  const listedBindings = new Set<string>();
  const contentRequests: string[] = [];
  const missing = Promise.withResolvers<void>();
  const firstMissing = Promise.withResolvers<void>();
  const missingPaths: string[] = [];
  let raceCreates = false;
  let raceFolders = false;
  let folderAttempts = 0;
  const firstFolder = Promise.withResolvers<void>();
  const bothFolders = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (legacyDownloads && path.startsWith("/blobs/")) {
        if (path.endsWith("/download"))
          return Response.json({ error: "Not found" }, { status: 404 });
        if (path.endsWith("/bytes")) legacyByteReads++;
      }
      if (/^\/(containers|documents|blobs)\//u.test(path))
        contentRequests.push(path);
      if (
        interruptUpload &&
        new URL(request.url).pathname === "/blobs/stages/multipart"
      )
        return new Response("unavailable", { status: 503 });
      if (raceFolders && path === "/containers/with-metadata-document") {
        folderAttempts++;
        firstFolder.resolve();
        if (folderAttempts === 2) bothFolders.resolve();
        await bothFolders.promise;
      }
      if (raceFolders && path === "/documents" && request.method === "POST")
        return new Response(null, { status: 503 });
      if (staleTarget && path === "/documents" && request.method === "POST") {
        staleTarget = false;
        return Response.json(
          { error: "Stale create target", code: "document_sync_state_stale" },
          { status: 409 },
        );
      }
      const response = await routeApp.fetch(request);
      if (
        rebindAfterHydration &&
        response.ok &&
        path.endsWith("/attachments")
      ) {
        const bindings = await response.clone().json();
        if (Array.isArray(bindings) && bindings.length) {
          if (listedBindings.has(path))
            return Response.json(
              bindings.map((binding) => ({
                ...binding,
                ...(rebindAfterHydration === "blob"
                  ? { blobId: crypto.randomUUID() }
                  : { bindingId: crypto.randomUUID() }),
              })),
            );
          listedBindings.add(path);
        }
      }
      if (
        raceCreates &&
        response.status === 404 &&
        path.endsWith("/writer-projection")
      ) {
        missingPaths.push(path);
        firstMissing.resolve();
        if (missingPaths.length === 2) missing.resolve();
        await missing.promise;
      }
      return response;
    },
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { seedPhrase, rootContainerId } =
      await registerCliTestAccount(apiBaseUrl);
    const { context, keyStore, output } = testContext({ apiBaseUrl });
    await keyStore.save("staging", seedPhrase);
    contentRequests.length = 0;
    expect(
      await runCli(
        ["seed", "--env", "staging", "--org", crypto.randomUUID()],
        context,
      ),
    ).toBe(1);
    expect(output.stderr).toEqual([
      "Seed requires the signed-in account's personal organization.",
    ]);
    expect(contentRequests).toEqual([]);
    output.stderr.length = 0;
    const { spec, readAttachment, datasetSha256 } =
      await loadContinuityAssets();
    const documents = continuityDocuments(spec);
    const oneTime = testContext({ apiBaseUrl, recoveryKey: seedPhrase });
    await oneTime.keyStore.save("staging", spec.identitySeedPhrase);
    const keychainCalls = [
      spyOn(oneTime.keyStore, "read"),
      spyOn(oneTime.keyStore, "save"),
      spyOn(oneTime.keyStore, "remove"),
    ];
    const tool = documents.find((document) => document.kind === "tool");
    const file = tool?.attachments[0]?.file;
    if (!tool || !file) throw new Error("Missing tool photo fixture");
    const size = (await readAttachment(file)).byteLength;
    const run = async (mode: "upload" | "resume", stdin = false) => {
      const log = stdin ? oneTime.output : output;
      const result = await runCli(
        [
          "seed",
          "--env",
          "staging",
          "--trace",
          ...(stdin ? ["--key-stdin"] : []),
        ],
        stdin ? oneTime.context : context,
      );
      const prefix = `  seed ${tool.key} `;
      const events = log.stderr.flatMap((line) => {
        const start = line.indexOf(prefix);
        return start < 0 || !line.includes(file)
          ? []
          : [line.slice(start + prefix.length)];
      });
      if (mode === "upload") {
        expect(events).toEqual([
          `uploading ${file} (${size} bytes)`,
          `stage opened for ${file}`,
          expect.stringContaining(`confirmed ${file} in `),
        ]);
        expect(events[2]).toMatch(/ in \d+ms$/);
      } else expect(events).toEqual([`skipped ${file} (held or edited slot)`]);
      expect(log.stderr.join("\n")).toContain(
        `confirm sync ${tool.key} done in `,
      );
      log.stderr.length = 0;
      expect(result).toBe(0);
      expect(log.stdout.at(-1)).toBe(
        `Synced ${documents.length} Continuity documents to your staging account.`,
      );
    };
    const device = { apiBaseUrl, recoveryKey: seedPhrase, rootContainerId };
    const other = testContext({ apiBaseUrl });
    await other.keyStore.save("staging", seedPhrase);
    // Finish each challenge exchange before the second client starts. Always
    // release a held API response if either importer exits before the barrier.
    async function runPair(
      firstRequest: Promise<void>,
      barrier: PromiseWithResolvers<void>,
    ) {
      const start = (client: typeof context) =>
        runCli(["seed", "--env", "staging"], client).finally(barrier.resolve);
      const first = start(context);
      await Promise.race([
        firstRequest,
        first.then(() => {
          throw new Error(
            `First seed exited before its request: ${output.stderr.join("\n")}`,
          );
        }),
      ]);
      const results = await Promise.all([first, start(other.context)]);
      return results;
    }
    raceFolders = true;
    expect(await runPair(firstFolder.promise, bothFolders)).toEqual([1, 1]);
    expect(
      folderAttempts,
      other.output.stderr.join("\n"),
    ).toBeGreaterThanOrEqual(2);
    raceFolders = false;
    output.stderr.length = 0;
    other.output.stderr.length = 0;
    raceCreates = true;
    const codes = await runPair(firstMissing.promise, missing);
    raceCreates = false;
    expect(codes).toEqual([1, 1]);
    expect(missingPaths).toHaveLength(2);
    expect(missingPaths[0]).toBe(missingPaths[1]);
    expect([...output.stderr, ...other.output.stderr].join("\n")).toContain(
      "/blobs/stages/multipart",
    );
    expect(output.stdout).toEqual([]);
    await onFreshDevice(device, async (stores, sdk) => {
      const avatar = spec.contacts?.[0]?.avatar;
      if (!avatar) throw new Error("Missing Continuity avatar");
      const store = stores.find((store) =>
        store.getSnapshot().attachments.some((a) => a.name === avatar.file),
      );
      const partial = store?.getSnapshot();
      const document = documents.find((item) => item.key === "contact/0");
      if (!partial?.documentId || !document || !store)
        throw new Error("Missing partially uploaded contact");
      // A Contacts folder is a placement. Even if the host resolves a
      // different Contacts destination later, this root-scoped identity holds.
      const keys = sdk.identity.signingKeyPair;
      if (!keys || !rootContainerId)
        throw new Error("Missing account identity");
      const expectedContact = createHmac("sha256", keys.signingPrivateKey)
        .update(
          `tearleads.continuity/${rootContainerId}/${datasetSha256}/contact/0`,
        )
        .digest("hex");
      expect(partial.documentId).toBe(
        await deriveStableDocumentId(expectedContact),
      );
      expect(partial.documentKind).toBe("contact");
      expect(partial.attachmentStorageKeyBySlotId).toEqual({});
      const localId = await sdk.documents.findLocalIdByDocumentId(
        partial.documentId,
      );
      if (!localId) throw new Error("Missing contact alias");
      const summary = await sdk.containerContents
        .documentQueries()
        .loadDocumentSummary(localId);
      if (!summary?.containerId) throw new Error("Missing contact placement");
      // A retry with bytes that differ from the recorded intent must leave
      // that intent available for recovery by its original writer.
      await expect(
        writeContinuityDocument({
          destination: "account",
          sdk,
          localId,
          containerId: summary.containerId,
          document,
          existing: { localId, documentId: partial.documentId },
          readAttachment: async () => new Uint8Array([1, 2, 3]),
        }),
      ).rejects.toThrow(
        "cannot confirm it created that document with the fixture content",
      );
      expect(store.getSnapshot().attachmentStorageKeyBySlotId).toEqual({});
      expect(store.getSnapshot().attachments).toEqual(partial.attachments);
    });
    interruptUpload = false;
    staleTarget = true;
    output.stderr.length = 0;
    await run("upload", true);
    expect(staleTarget).toBe(false);
    legacyDownloads = true;
    expect(
      await runCli(
        ["verify-seed", "--env", "staging", "--key-stdin"],
        oneTime.context,
      ),
      oneTime.output.stderr.join("\n"),
    ).toBe(0);
    legacyDownloads = false;
    expect(legacyByteReads).toBeGreaterThan(0);
    for (const call of keychainCalls) expect(call).not.toHaveBeenCalled();
    expect(oneTime.keyStore.items.get("staging")).toBe(spec.identitySeedPhrase);
    expect(oneTime.output.stdout.at(-1)).toContain(
      `Verified ${documents.length} documents`,
    );
    for (const change of ["blob", "binding"] as const) {
      listedBindings.clear();
      rebindAfterHydration = change;
      expect(await runCli(["verify-seed", "--env", "staging"], context)).toBe(
        1,
      );
      expect(output.stderr.at(-1)).toContain("Attachment bindings differ");
    }
    rebindAfterHydration = null;
    output.stderr.length = 0;
    // Use the actual signed fixture heads and ask the verifier to check them
    // against a different account. A verifier that omits the signer accepts them.
    const loadHead = sdkModule.createDocumentHeadLinkSetLoader;
    const signer = spyOn(
      sdkModule,
      "createDocumentHeadLinkSetLoader",
    ).mockImplementation((...args) => {
      const lookup = loadHead(...args);
      return (id, hash, expectedSigner) =>
        lookup(id, hash, expectedSigner && crypto.randomUUID());
    });
    try {
      expect(await runCli(["verify-seed", "--env", "staging"], context)).toBe(
        1,
      );
      expect(output.stderr.at(-1)).toContain(
        "Could not verify seed creator and placement",
      );
    } finally {
      signer.mockRestore();
    }
    output.stderr.length = 0;
    const createStore = sdkModule.createMemoryBlobStore;
    const stores = spyOn(sdkModule, "createMemoryBlobStore").mockImplementation(
      () => {
        const store = createStore();
        const open = store.openByteSource.bind(store);
        store.openByteSource = async (key) => {
          const source = await open(key);
          if (!source) return null;
          return {
            byteLength: source.byteLength,
            read: async (offset, length) => {
              const bytes = await source.read(offset, length);
              if (bytes.length) bytes[0] = (bytes[0] ?? 0) ^ 1;
              return bytes;
            },
          };
        };
        return store;
      },
    );
    try {
      expect(await runCli(["verify-seed", "--env", "staging"], context)).toBe(
        1,
      );
      expect(output.stderr.at(-1)).toMatch(/^Attachment bytes differ: .+ \/ /u);
    } finally {
      stores.mockRestore();
    }
    output.stderr.length = 0;
    const editedName = "Personal weight journal";
    const editedNotes = "Edited on a second device";
    let additionalFolderId = "";
    let movedContactId = "";
    await onFreshDevice(device, async (stores, sdk) => {
      const contact = stores.find(
        (store) => store.getSnapshot().documentKind === "contact",
      );
      if (!contact) throw new Error("Missing seeded contact");
      await publishSeedEdit(sdk, contact, (doc) =>
        doc.getMap("fields").set("encapsulationPublicKey", 42),
      );
    });
    expect(await runCli(["verify-seed", "--env", "staging"], context)).toBe(1);
    expect(output.stderr.at(-1)).toMatch(/Fixture content differs: contact\//u);
    output.stderr.length = 0;
    // This device must pull the edit before rotating the contact's link.
    await onFreshDevice(device, async (stores, sdk) => {
      const tracker = stores.find(
        (store) => store.getSnapshot().documentKind === "weight",
      );
      const row = tracker?.getSnapshot().rows[0];
      if (!tracker || !row) throw new Error("Missing weight tracker row");
      await tracker.setStructuredFields("weight", { trackerName: editedName });
      await tracker.updateRowFields(row.id, { notes: editedNotes });
      expect(await tracker.requestRemoteSyncAndWait()).toBe(true);
      if (!rootContainerId) throw new Error("Missing root");
      const folder = await sdk.containerContents
        .openTree()
        .createChild(rootContainerId, "Health");
      if (!folder) throw new Error("Could not create Health folder");
      additionalFolderId = folder.id;
      const coordinator = getOrCreateDomainSyncCoordinator(
        sdk.runtime.input().state.domainScope,
      );
      expect(await coordinator.waitForIdle({ timeoutMs: 30_000 })).toBe(true);
      movedContactId =
        stores
          .find(
            (candidate) => candidate.getSnapshot().documentKind === "contact",
          )
          ?.getSnapshot().documentId ?? "";
      for (const remoteId of [
        tracker.getSnapshot().documentId,
        movedContactId,
      ]) {
        const id = await sdk.documents.findLocalIdByDocumentId(remoteId ?? "");
        const note = await sdk.containerContents
          .documentQueries()
          .loadDocumentSummary(id ?? "");
        if (!note) throw new Error("Missing seed document summary");
        const moved = await sdk.containerContents
          .documentLinks()
          .moveDocumentToContainer({
            note,
            targetContainerId: folder.id,
            replaceLinkedContainers: true,
            expandNode: () => {},
            mergeDocumentSummary: () => {},
            setLinkedContainerIdsForDocument: () => {},
          });
        expect(moved.note?.containerId).toBe(folder.id);
      }
      expect(await coordinator.waitForIdle({ timeoutMs: 30_000 })).toBe(true);
    });
    contentRequests.length = 0;
    await run("resume");
    expect(contentRequests).not.toContain("/containers/documents/query");
    await onFreshDevice(
      { ...device, additionalFolderId, movedContactId },
      async (stores, sdk) => {
        const found = stores.map((store) => store.getSnapshot());
        const tracker = found.find(
          (snapshot) => snapshot.documentKind === "weight",
        );
        for (const remoteId of [tracker?.documentId, movedContactId]) {
          const id = await sdk.documents.findLocalIdByDocumentId(
            remoteId ?? "",
          );
          const moved = await sdk.containerContents
            .documentQueries()
            .loadDocumentSummary(id ?? "");
          expect(moved?.containerId).toBe(additionalFolderId);
        }
        for (const snapshot of found) {
          for (const attachment of snapshot.attachments) {
            const key =
              snapshot.attachmentStorageKeyBySlotId[attachment.slotId];
            expect(key).toBeDefined();
            expect(await sdk.blobs.store.readBytes(key ?? "")).toEqual(
              await readAttachment(attachment.name),
            );
          }
        }
        expect(found.length).toBe(documents.length);
        for (const document of documents) {
          expect(found).toContainEqual(
            expect.objectContaining({
              documentKind: document.kind,
              text: document.text ?? "",
              structuredFields: expect.objectContaining(
                document.kind === "weight"
                  ? { ...document.fields, trackerName: editedName }
                  : (document.fields ?? {}),
              ),
              rows: (document.rows ?? []).map((fields, index) =>
                expect.objectContaining({
                  fields:
                    document.kind === "weight" && index === 0
                      ? { ...fields, notes: editedNotes }
                      : fields,
                }),
              ),
              attachments: expect.arrayContaining(
                document.attachments.map(({ file: name }) =>
                  expect.objectContaining({ name }),
                ),
              ),
            }),
          );
        }
      },
    );
  } finally {
    missing.resolve();
    bothFolders.resolve();
    server.stop(true);
  }
  // About 107s on CI, and runners have run 1.8x slower; keep ~3x headroom.
}, 360_000);
