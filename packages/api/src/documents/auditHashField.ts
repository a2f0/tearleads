// Length-prefixed field encoding used to build canonical audit-hash payloads.
// The `name:length:value` framing makes the concatenated payload unambiguous so
// distinct field sequences can never collide into the same hash input.
export function serializeAuditHashField(name: string, value: string): string {
  return `${name}:${value.length}:${value}`;
}
