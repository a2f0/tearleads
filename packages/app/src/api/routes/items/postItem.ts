import { isSetItemRequest } from "@tearleads/validators/request";
import { isSetItemResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function postItem(request: RequestFn, encryptedData: string) {
  const body = { encryptedData };
  if (!isSetItemRequest(body)) {
    throw new Error("Invalid SetItemRequest");
  }
  return request("/items", isSetItemResponse, "POST", JSON.stringify(body));
}
