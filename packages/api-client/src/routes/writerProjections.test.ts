import { expect, test } from "bun:test";
import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
} from "@tearleads/validators/operation";
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
  expect(containerWriterProjection.isResponseFor("container/1")).toBeDefined();

  expect(documentWriterProjection).toMatchObject({
    method: getDocumentWriterProjectionOperation.method,
  });
  expect(documentWriterProjection.path("document/1")).toBe(
    "/documents/document%2F1/writer-projection",
  );
  expect(documentWriterProjection.isResponseFor("document/1")).toBeDefined();
});
