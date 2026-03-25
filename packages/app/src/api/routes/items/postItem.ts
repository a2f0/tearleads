import { isSetItemRequest } from "@tearleads/validators/request";
import { isSetItemResponse } from "@tearleads/validators/response";
import { request } from "../../util/request";

export function postItem(encryptedData: string) {
  const body = { encryptedData };
  if (!isSetItemRequest(body)) {
    throw new Error("Invalid SetItemRequest");
  }
  return request("/items", isSetItemResponse, "POST", JSON.stringify(body));
}
