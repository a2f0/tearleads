import {
  type AccessEvent,
  type AccessManifest,
  computeAccessManifestBundleDigest,
  readKeyingCanonicalJson,
} from "@tearleads/crypto";
import {
  type ServedAccessManifestBundleWireResponse,
  toServedAccessManifestBundle,
} from "@tearleads/validators/util";
import { readCanonicalRecord } from "../../keying/canonicalJson";

/** The signed parts and derived state of a head this client authored. */
export interface AuthoredManifestBundle {
  readonly body: unknown;
  readonly event: AccessEvent;
  readonly eventHash: string;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly state: object;
}

/**
 * The bundle a writer projection serves for a head this client authored,
 * built from its own signed plan, when it has exactly the citation digest
 * the acknowledgement named. A projection request may then cite it instead
 * of downloading it back. Any difference only means the next read carries
 * those bytes: a cited projection is verified from scratch, and a stored
 * bundle that fails verification is dropped and read again uncited.
 */
export async function acknowledgedAuthoredBundle(
  plan: AuthoredManifestBundle,
  bundleDigest: string,
): Promise<ServedAccessManifestBundleWireResponse | null> {
  try {
    const served = toServedAccessManifestBundle({
      event: {
        body: readKeyingCanonicalJson(plan.body, "Authored event body"),
        event: readCanonicalRecord({ ...plan.event }, "Authored event"),
        eventHash: plan.eventHash,
      },
      manifest: readCanonicalRecord({ ...plan.manifest }, "Authored manifest"),
      manifestHash: plan.manifestHash,
      state: readCanonicalRecord({ ...plan.state }, "Authored state"),
    });
    return (await computeAccessManifestBundleDigest(served)) === bundleDigest
      ? served
      : null;
  } catch {
    return null;
  }
}
