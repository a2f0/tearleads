import { reconstructServedAccessManifestStates } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { ManifestStateReconstructor } from "@tearleads/validators/response";

/**
 * Writer projections serve each manifest bundle without its derived state.
 * Decoding rebuilds it from the signed bodies along the served predecessor
 * chain, the value the API stores; it is unverified, as the served state
 * was, and the SDK verifier still requires it to equal the state it derives.
 */
export const reconstructServedManifestStates: ManifestStateReconstructor = (
  bundles,
) => {
  const states = new Map<string, Record<string, unknown> | null>();
  for (const [hash, state] of reconstructServedAccessManifestStates(bundles))
    states.set(hash, isPlainObject(state) ? state : null);
  return states;
};
