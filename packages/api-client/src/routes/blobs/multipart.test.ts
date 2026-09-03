import { expect, test } from "bun:test";
import {
  completeMultipartBlobStageOperation,
  getMultipartBlobStageOperation,
  initiateMultipartBlobStageOperation,
} from "@tearleads/validators/operation";
import {
  completeMultipartBlobStage,
  getMultipartBlobStage,
  initiateMultipartBlobStage,
} from "./multipart";

const stageId = "11111111-1111-4111-8111-111111111111";

test("multipart control client metadata derives from shared operations", () => {
  expect(initiateMultipartBlobStage).toMatchObject({
    method: initiateMultipartBlobStageOperation.method,
    path: "/blobs/stages/multipart",
  });
  expect(getMultipartBlobStage).toMatchObject({
    method: getMultipartBlobStageOperation.method,
  });
  expect(completeMultipartBlobStage).toMatchObject({
    method: completeMultipartBlobStageOperation.method,
  });
  expect(getMultipartBlobStage.path(stageId)).toBe(
    `/blobs/stages/multipart/${stageId}`,
  );
  expect(completeMultipartBlobStage.path(stageId)).toBe(
    `/blobs/stages/multipart/${stageId}/complete`,
  );
  expect(initiateMultipartBlobStage.isRequest).toBeDefined();
  expect(initiateMultipartBlobStage.isResponse).toBeDefined();
  expect(getMultipartBlobStage.isResponse).toBeDefined();
  expect(completeMultipartBlobStage.isRequest).toBeDefined();
  expect(completeMultipartBlobStage.isResponse).toBeDefined();
  expect(() => getMultipartBlobStage.path("invalid")).toThrow(
    "Invalid path parameters for blobs.multipartStages.get",
  );
});
