import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface SetItemRequest {
  encryptedData: string;
}

export function isSetItemRequest(value: unknown): value is SetItemRequest {
  return isPlainObject(value) && hasStringProperty(value, "encryptedData");
}
