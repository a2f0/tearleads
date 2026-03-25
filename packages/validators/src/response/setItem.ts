import { isPlainObject } from "../isPlainObject";

export interface SetItemResponse {
  id: string;
}

export function isSetItemResponse(value: unknown): value is SetItemResponse {
  return isPlainObject(value) && typeof value["id"] === "string";
}
