import { isSetItemResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function postItem(request: RequestFn, encryptedData: string) {
  return request(
    "/items",
    isSetItemResponse,
    "POST",
    JSON.stringify({ encryptedData }),
  );
}
