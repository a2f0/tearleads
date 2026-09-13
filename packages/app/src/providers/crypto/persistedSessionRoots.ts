import type { SessionSnapshot } from "@tearleads/client-sdk";
import { isPlainObject } from "@tearleads/validators/isPlainObject";

export function parsePersistedSessionRoots(
  value: unknown,
  signingFingerprint: string,
  userId: string | null | undefined,
): SessionSnapshot["rootAcknowledgments"] | null {
  if (!Array.isArray(value)) return null;
  const roots: Array<SessionSnapshot["rootAcknowledgments"][number]> = [];
  const organizations = new Set<string>();
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof userId !== "string") return null;
    const organizationId = Reflect.get(entry, "organizationId");
    const rootContainerId = Reflect.get(entry, "rootContainerId");
    if (
      Reflect.get(entry, "signingFingerprint") !== signingFingerprint ||
      Reflect.get(entry, "userId") !== userId ||
      typeof organizationId !== "string" ||
      organizations.has(organizationId) ||
      !(typeof rootContainerId === "string" || rootContainerId === null)
    )
      return null;
    organizations.add(organizationId);
    roots.push({ signingFingerprint, userId, organizationId, rootContainerId });
  }
  return roots;
}
