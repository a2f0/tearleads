import { isGetItemResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getItem(request: RequestFn, itemId: string) {
  return request(`/items/${itemId}`, isGetItemResponse, "GET");
}
