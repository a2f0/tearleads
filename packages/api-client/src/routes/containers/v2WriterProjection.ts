import { isContainerV2WriterProjectionResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getContainerV2WriterProjection(
  request: RequestFn,
  containerId: string,
) {
  return request(
    `/v2/containers/${containerId}/writer-projection`,
    isContainerV2WriterProjectionResponse,
    "GET",
  );
}
