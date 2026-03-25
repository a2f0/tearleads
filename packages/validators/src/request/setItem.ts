import { isPlainObject } from "../isPlainObject";

export interface SetItemRequest {
  payload: string;
  encryptedData: string;
  spicedbZedToken: string;
}

export function isSetItemRequest(value: unknown): value is SetItemRequest {
  return (
    isPlainObject(value) &&
    typeof value["payload"] === "string" &&
    typeof value["encryptedData"] === "string" &&
    typeof value["spicedbZedToken"] === "string"
  );
}
