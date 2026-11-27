// An unlink's route takes a body twice the size of a sync's, and a response
// page serves no single update larger than that route's ceiling. So an
// inline rotation baseline segment is held, whole, to what a sync request
// may carry: the request is refused as it is read, before anything of it is
// verified or stored, and no update is accepted that a pull cannot serve.
import { expect, test } from "bun:test";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@tearleads/validators/util";
import {
  documentWithHistory,
  linkedForUnlink,
  postJson,
  storedUpdates,
} from "../../../test/helpers/baselineGroupRouteKit";

test("an unlink refuses an inline baseline segment larger than a sync request", async () => {
  const history = await documentWithHistory();
  const { created, owner } = history;
  const request = await (await linkedForUnlink(history))({
    rotationBaselineSegments: 2,
  });
  const [first, final] = request.rotationBaseline ?? [];
  if (!first || !final) throw new Error("Expected two segments");
  const before = (await storedUpdates(created.id)).map((row) => row.id);
  const half = "A".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES / 2);

  for (const heavy of [
    // One string past an update's field bound.
    { ...first, encryptedData: `${half}${half}A` },
    // Strings that each pass it and together do not.
    { ...first, encryptedData: half, partialStartVersionVector: half },
    // A field with no bound of its own.
    { ...first, plaintextHash: `${half}${half}` },
  ]) {
    const refused = await postJson(owner, `/documents/${created.id}/unlink`, {
      ...request,
      rotationBaseline: [heavy, final],
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "Invalid request" });
  }
  expect((await storedUpdates(created.id)).map((row) => row.id)).toEqual(
    before,
  );

  // The honest request is accepted.
  const accepted = await postJson(
    owner,
    `/documents/${created.id}/unlink`,
    request,
  );
  expect(accepted.status).toBe(200);
  expect((await storedUpdates(created.id)).map((row) => row.id)).toEqual([
    ...before,
    first.id,
    final.id,
  ]);
});
