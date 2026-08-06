import { expect, test } from "bun:test";
import {
  containerCreate,
  containerCreateWithMetadataDocument,
  containerDelete,
  containerMove,
  containerRekey,
  containerRevoke,
  containerShare,
} from "./mutations";

test("container mutation client metadata derives from shared operations", () => {
  expect(containerCreate).toMatchObject({
    method: "POST",
    path: "/containers",
  });
  expect(containerCreate.isRequest).toBeDefined();
  expect(containerCreate.isResponse).toBeDefined();

  expect(containerCreateWithMetadataDocument).toMatchObject({
    method: "POST",
    path: "/containers/with-metadata-document",
  });
  expect(containerCreateWithMetadataDocument.isRequest).toBeDefined();
  expect(containerCreateWithMetadataDocument.isResponse).toBeDefined();

  for (const mutation of [
    [containerShare, "share"],
    [containerRevoke, "revoke"],
    [containerRekey, "rekey"],
    [containerMove, "move"],
  ] as const) {
    const [metadata, suffix] = mutation;
    expect(metadata.method).toBe("POST");
    expect(metadata.path("container/1")).toBe(
      `/containers/container%2F1/${suffix}`,
    );
    expect(metadata.isRequest).toBeDefined();
    expect(metadata.isResponse).toBeDefined();
  }

  expect(containerDelete.method).toBe("DELETE");
  expect(containerDelete.path("container/1")).toBe("/containers/container%2F1");
  expect(containerDelete.isResponse).toBeDefined();
});
