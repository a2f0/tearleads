import { computeContainerKekLevelDigest } from "@tearleads/crypto";
import {
  type ContainerKekResponse,
  type ContainerKeyingPathResponse,
  containerKekWireLevel,
  type HeldKekLevelDigest,
} from "@tearleads/validators/response";

/**
 * Names each KEK level of `paths` whose canonical wire digest the request
 * declared held (`k:` hints). The digest is taken over the bytes this
 * response would serve, so an omitted level is exactly the held copy: a
 * rotated epoch, a new wrap, or any other change gives a new digest and the
 * level travels in full. Unknown digests are ignored.
 */
export async function heldKekLevelDigests(
  paths: readonly ContainerKeyingPathResponse[],
  kekLevels: readonly string[],
): Promise<HeldKekLevelDigest> {
  if (kekLevels.length === 0) return () => null;
  const held = new Set(kekLevels);
  const digests = new Map<ContainerKekResponse, string>();
  for (const path of paths)
    for (const kek of path.containerKeks) {
      const digest = await computeContainerKekLevelDigest(
        containerKekWireLevel(kek),
      );
      if (digest !== null && held.has(digest)) digests.set(kek, digest);
    }
  return (kek) => digests.get(kek) ?? null;
}
