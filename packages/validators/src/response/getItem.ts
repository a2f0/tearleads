import { isPlainObject } from "../isPlainObject";

export interface GetItemResponse {
  id: string;
  encryptedData: string;
  createdAt: string;
}

export function isGetItemResponse(value: unknown): value is GetItemResponse {
  return (
    isPlainObject(value) &&
    typeof value["id"] === "string" &&
    typeof value["encryptedData"] === "string" &&
    typeof value["createdAt"] === "string"
  );
}
