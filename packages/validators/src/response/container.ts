import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface CreateContainerResponse {
  id: string;
  organizationId: string;
  parentId: string;
  name: string;
}

export function isCreateContainerResponse(
  value: unknown,
): value is CreateContainerResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "organizationId") &&
    hasStringProperty(value, "parentId") &&
    hasStringProperty(value, "name")
  );
}
