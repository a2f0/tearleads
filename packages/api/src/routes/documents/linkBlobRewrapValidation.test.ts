import { expect, test } from "bun:test";
import {
  blobRewrapFixture,
  expectBlobRewrapUnchanged,
  postBlobRewrap,
  snapshotBlobRewrap,
} from "../../../test/helpers/blobRewrapReadbackKit";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";

for (const scenario of [
  "epoch",
  "target",
  "scope",
  "malformed new target",
] as const) {
  test(`signed blob rewrap refuses ${scenario} mismatch without changing state`, async () => {
    const fixture = await blobRewrapFixture();
    const child = { ...fixture.childTarget };
    if (scenario === "target") child.containerKeyEpoch = 9;
    if (scenario === "scope") child.documentId = crypto.randomUUID();
    if (scenario === "malformed new target") child.wrappedKey = "AA==";
    const request = await buildDocumentLinkRequest({
      ...fixture,
      createdDocument: fixture.document,
      blobRewraps: [
        {
          blobId: fixture.blobId,
          contentKeyEpoch: scenario === "epoch" ? 2 : 1,
          targets: [fixture.rootTarget, child],
        },
      ],
    });
    const before = await snapshotBlobRewrap(fixture);
    const response = await postBlobRewrap(fixture, "link", request);
    const errors = {
      epoch: "Blob content key epoch changed",
      target: "Blob content-key targets do not match current KEK targets",
      scope: "Document blob rewrap leaves the signed document scope",
      "malformed new target":
        "Blob content-key target wrapped key has an invalid encoded length",
    };
    expect(response).toEqual({
      status:
        scenario === "malformed new target" || scenario === "scope" ? 400 : 409,
      body: { error: errors[scenario] },
    });
    await expectBlobRewrapUnchanged(fixture, before);
  });
}
