import { expect, test } from "bun:test";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../src/document-types/projectors";
import { trackerGraphTimestamp } from "../../src/document-types/shared/timeSeriesGraphData";
import { restoreBackupPayload } from "../../src/providers/db/localBackupData";
import { decodeBackupFile } from "../../src/providers/db/localBackupFormat";
import { unexpectedSecurityIncidents } from "../helpers/unexpectedSecurityIncidents";
import { buildSeedArtifact } from "./buildSeedArtifact";
import { loadContinuityAssets } from "./continuityAssets";

test("pinned Continuity restores every promised document, photo, and tracker row into a fresh database", async () => {
  const { spec, readAttachment } = await loadContinuityAssets();
  const expected = JSON.parse(
    new TextDecoder().decode(await readAttachment("expectations.json")),
  );
  const source = await createTestExecSql("continuity-source");
  const target = await createTestExecSql("continuity-target");
  const blobStore = createMemoryBlobStore();
  const sdk = new Tearleads({
    blobStoreFactory: () => blobStore,
    database: { execSql: target.execSql as ExecSql, id: "continuity-restored" },
    documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    logger: { log: () => undefined, logError: () => undefined },
    online: false,
  });
  try {
    const artifact = await buildSeedArtifact(spec, {
      blobStore: createMemoryBlobStore(),
      execSql: source.execSql as ExecSql,
      readAttachment,
    });
    const payload = await decodeBackupFile({
      password: spec.password,
      text: artifact.text,
    });
    expect(payload.summary.blobCount).toBe(24);
    await restoreBackupPayload({
      blobStore,
      execSql: target.execSql as ExecSql,
      payload,
      securityIncidents: unexpectedSecurityIncidents,
    });
    await sdk.identity.importSeedPhrase(spec.identitySeedPhrase);
    const contacts = await sdk.documents.list({ documentKind: "contact" });
    expect(contacts?.totalCount).toBe(spec.contacts?.length);
    expect(contacts?.rows.map((row) => row.title)).toContain(
      expected.contact.displayName,
    );
    const notes = await sdk.documents.list({ documentKind: "note" });
    expect(notes?.totalCount).toBe(spec.notes?.length);
    expect(notes?.rows.map((row) => row.title)).toContain(expected.note.title);

    for (const [kind, details] of [
      ["drivers_license", [expected.driversLicense]],
      ["passport", [expected.passport]],
      ["birth_certificate", [expected.birthCertificate]],
      ["credit_card", [expected.creditCard]],
      ["image", expected.photos],
      ["tool", expected.tools],
      ["appliance", expected.appliances],
      ["weight", [expected.weight]],
      ["blood_pressure", [expected.bloodPressure]],
    ] as const) {
      const documents = await sdk.documents.list({ documentKind: kind });
      const fixtures = spec.files?.filter((file) => file.kind === kind) ?? [];
      expect(documents?.totalCount).toBe(details.length);
      for (const [index, detail] of details.entries()) {
        const summary = documents?.rows.find(
          (row) => row.title === detail.title,
        );
        expect(summary).toBeDefined();
        if (!summary) throw new Error(`Missing restored ${detail.title}`);
        const store = sdk.documents.open({
          localId: summary.id,
          containerId: summary.containerId,
        });
        await store.ensureInitialized();
        const snapshot = store.getSnapshot();
        const fixture = fixtures[index];
        expect(snapshot.fieldValidationIssues).toEqual([]);
        expect(snapshot.structuredFields).toMatchObject(fixture?.fields ?? {});
        expect(snapshot.rows.map((row) => row.fields)).toEqual([
          ...(fixture?.rows ?? []).map(({ measuredAt = "", ...fields }) => ({
            ...fields,
            measuredAt: measuredAt.slice(0, 19),
          })),
        ]);
        for (const {
          fields: { measuredAt = "" },
        } of snapshot.rows) {
          expect(Number.isFinite(trackerGraphTimestamp(measuredAt))).toBe(true);
        }
        expect(snapshot.attachments).toHaveLength(detail.imageCount ?? 0);
        expect(
          new Set(snapshot.attachments.map((attachment) => attachment.slotId))
            .size,
        ).toBe(snapshot.attachments.length);
        for (const attachment of snapshot.attachments) {
          const key = snapshot.attachmentStorageKeyBySlotId[attachment.slotId];
          expect(key).toBeDefined();
          expect(await blobStore.readBytes(key ?? "")).toEqual(
            await readAttachment(attachment.name),
          );
          if (
            (kind === "tool" || kind === "appliance") &&
            attachment.slotId !== "receipt-image"
          )
            expect(attachment.slotId).toStartWith("equipment-photos:");
        }
      }
    }
  } finally {
    sdk.dispose();
    source.close();
    target.close();
  }
}, 30_000);
