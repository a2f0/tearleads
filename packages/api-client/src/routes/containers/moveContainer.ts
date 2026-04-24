import { isMoveContainerResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function moveContainer(
  request: RequestFn,
  containerId: string,
  parentId: string,
  expectedAccessStateHash: string,
) {
  return request(
    `/containers/${containerId}/move`,
    isMoveContainerResponse,
    "POST",
    JSON.stringify({
      expectedAccessStateHash,
      parentId,
    }),
  );
}
