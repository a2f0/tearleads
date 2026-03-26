interface UserEvent {
  userId: string;
}

export function isUserEvent(value: unknown): value is UserEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "userId" in value &&
    typeof (value as UserEvent).userId === "string"
  );
}
