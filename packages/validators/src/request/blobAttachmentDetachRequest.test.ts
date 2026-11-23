import { expect, test } from "bun:test";
import { isBlobAttachmentDetachRequest } from "./index";
import { createContainerMutationRequest } from "./requestTestFixtures";

const validRequest = {
  event: { eventType: "attachment.detach" },
  body: { eventType: "attachment.detach" },
  authorizingContainerPathRefs: [
    [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
  ],
  containerRekeys: [createContainerMutationRequest()],
  documentVersionVector: "document-version-vector",
};

test("isBlobAttachmentDetachRequest", () => {
  expect(isBlobAttachmentDetachRequest(validRequest)).toBe(true);
  expect(
    isBlobAttachmentDetachRequest({
      ...validRequest,
      authorizingContainerPathRefs: [
        { containerId: "container-1", manifestHash: "container-manifest-hash" },
      ],
    }),
  ).toBe(false);
  expect(
    isBlobAttachmentDetachRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isBlobAttachmentDetachRequest(null)).toBe(false);
});

test("a detach names the document version it read the slot removed at", () => {
  const { documentVersionVector: _version, ...withoutVersion } = validRequest;
  expect(isBlobAttachmentDetachRequest(withoutVersion)).toBe(false);
  expect(
    isBlobAttachmentDetachRequest({
      ...validRequest,
      documentVersionVector: "",
    }),
  ).toBe(false);
});

test("a detach may carry the processed cursor its version holds", () => {
  expect(
    isBlobAttachmentDetachRequest({
      ...validRequest,
      processedThroughUpdateId: "550e8400-e29b-41d4-a716-446655440005",
    }),
  ).toBe(true);
  expect(
    isBlobAttachmentDetachRequest({
      ...validRequest,
      processedThroughUpdateId: "not-an-update-id",
    }),
  ).toBe(false);
});
