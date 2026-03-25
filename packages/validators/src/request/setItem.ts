import { isPlainObject } from "../isPlainObject";

export interface SetItemRequest {
  encryptedData: string;
}

export function isSetItemRequest(value: unknown): value is SetItemRequest {
  return isPlainObject(value) && typeof value["encryptedData"] === "string";
}
