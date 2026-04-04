import { isListContainersResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function listContainers(request: RequestFn) {
  return request("/containers", isListContainersResponse, "GET");
}
