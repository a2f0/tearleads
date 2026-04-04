import { isCreateContainerResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function createContainer(
  request: RequestFn,
  id: string,
  parentId: string,
) {
  return request(
    "/containers",
    isCreateContainerResponse,
    "POST",
    JSON.stringify({ id, parentId }),
  );
}
