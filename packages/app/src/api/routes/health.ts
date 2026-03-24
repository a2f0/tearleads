import type { HealthResponse } from "@tearleads/validators/response";
import { request } from "../util/request";

export function getHealth() {
  return request<HealthResponse>("/");
}
