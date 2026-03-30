import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface SetItemResponse {
  id: string;
}

export function isSetItemResponse(value: unknown): value is SetItemResponse {
  return isPlainObject(value) && hasStringProperty(value, "id");
}
