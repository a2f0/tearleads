import { isHealthResponse } from "@tearleads/validators/response";
import { request } from "../util/request";

export function getHealth() {
  return request("/", isHealthResponse, "GET");
}
