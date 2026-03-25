import { isGetItemResponse } from "@tearleads/validators/response";
import { request } from "../../util/request";

export function getItem(itemId: string) {
  return request(`/items/${itemId}`, isGetItemResponse, "GET");
}
