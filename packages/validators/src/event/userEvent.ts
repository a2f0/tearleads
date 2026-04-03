import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

interface UserEvent {
  userId: string;
}

export function isUserEvent(value: unknown): value is UserEvent {
  return isPlainObject(value) && hasStringProperty(value, "userId");
}
