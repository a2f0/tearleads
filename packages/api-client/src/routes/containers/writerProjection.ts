import { isContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getContainerWriterProjection(
  request: RequestFn,
  containerId: string,
) {
  return request(
    `/containers/${containerId}/writer-projection`,
    isContainerWriterProjectionResponse,
    "GET",
  );
}
