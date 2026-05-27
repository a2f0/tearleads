import { isContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function getContainerWriterProjection(
  request: RequestFn,
  containerId: string,
) {
  return request(
    `/containers/${pathSegment(containerId)}/writer-projection`,
    isContainerWriterProjectionResponse,
    "GET",
  );
}
