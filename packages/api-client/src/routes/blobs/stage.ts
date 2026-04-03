import type { StageBlobRequest } from "@tearleads/validators/request";
import { isStageBlobResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function stageBlob(request: RequestFn, input: StageBlobRequest) {
  return request(
    "/blobs/stage",
    isStageBlobResponse,
    "POST",
    JSON.stringify(input),
  );
}
