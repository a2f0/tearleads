const admissions = new WeakMap<object, () => void>();

/** Transport registers immutable candidates; only successful SDK verification admits one. */
export function registerProjectionHistoryAdmission(
  projection: object,
  admit: () => void,
): void {
  admissions.set(projection, admit);
}

/** Does not grant access or advance a security checkpoint. */
export function retainVerifiedProjectionHistory(projection: object): void {
  const admit = admissions.get(projection);
  admissions.delete(projection);
  admit?.();
}
