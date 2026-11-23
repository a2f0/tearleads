import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { DocumentSyncRequestSchema } from "@tearleads/validators/request";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

const CURSOR = "550e8400-e29b-41d4-a716-446655440e11";

async function heldVersion(): Promise<string> {
  const document = await createDocument("plan-cursor-held");
  document.getText("text").insert(0, "held");
  document.commit();
  const version = encodeVersionVector(document);
  document.free();
  return version;
}

test("a plan carries the processed cursor only with the version it was recorded with", async () => {
  const fixture = await createMaterializedSyncFixture();
  const plan = (input: {
    readonly historyMode?: "raw";
    readonly localVersionVector: string | null;
  }) =>
    buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      pendingUpdates: [],
      processedThroughUpdateId: CURSOR,
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.writerProjection,
      ...input,
    });

  const versioned = (await plan({ localVersionVector: await heldVersion() }))
    .plan.request;
  expect(versioned.processedThroughUpdateId).toBe(CURSOR);

  // A pull without a version vector, and a raw-history pull, read the whole
  // history: neither may skip what the cursor stands for, and the server
  // refuses a cursor without a version vector.
  for (const request of [
    (await plan({ localVersionVector: null })).plan.request,
    (await plan({ historyMode: "raw", localVersionVector: null })).plan.request,
  ]) {
    expect("processedThroughUpdateId" in request).toBe(false);
    expect(DocumentSyncRequestSchema.safeParse(request).success).toBe(true);
  }
});
