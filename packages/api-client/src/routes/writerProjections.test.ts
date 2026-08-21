import { expect, test } from "bun:test";
import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
} from "@symcrypt/validators/operation";
import {
  containerWriterProjection,
  documentWriterProjection,
} from "./writerProjections";

test("writer projection client metadata derives from shared operations", () => {
  expect(containerWriterProjection).toMatchObject({
    method: getContainerWriterProjectionOperation.method,
  });
  expect(containerWriterProjection.path("container/1")).toBe(
    "/containers/container%2F1/writer-projection",
  );
  expect(containerWriterProjection.isResponse).toBeDefined();

  expect(documentWriterProjection).toMatchObject({
    method: getDocumentWriterProjectionOperation.method,
  });
  expect(documentWriterProjection.path("document/1")).toBe(
    "/documents/document%2F1/writer-projection",
  );
  expect(documentWriterProjection.isResponse).toBeDefined();
});
