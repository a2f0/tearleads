import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface GetItemResponse {
  id: string;
  encryptedData: string;
  createdAt: string;
}

export function isGetItemResponse(value: unknown): value is GetItemResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "encryptedData") &&
    hasStringProperty(value, "createdAt")
  );
}
