import { isHealthResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../types";

export function getHealth(request: RequestFn) {
  return request("/health", isHealthResponse, "GET");
}
