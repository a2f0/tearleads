import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface CreateContainerRequest {
  id: string;
  parentId: string;
  name: string;
}

export function isCreateContainerRequest(
  value: unknown,
): value is CreateContainerRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "parentId") &&
    hasStringProperty(value, "name")
  );
}
