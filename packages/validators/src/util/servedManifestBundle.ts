import type { z } from "zod";
import { isPlainObject } from "../isPlainObject";
import {
  loosePlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
} from "../schema";
import {
  AccessEventBundleWireResponseSchema,
  type AccessManifestBundleWireResponse,
} from "./accessManifestBundle";

/**
 * A bundle as a writer projection serves it. Its `state` carries only what the
 * bundle's own signed bytes do not: the derived fields the hash-committed
 * manifest names (version, object id, organization, epoch, predecessor and
 * event hash) and, for a container, the key epoch and public key its signed
 * body names are left off, and the client fills them back from those bytes
 * when it decodes. The verifier still requires the completed state to equal
 * the state it derives.
 */
export const ServedAccessManifestBundleWireResponseSchema = loosePlainObject({
  event: AccessEventBundleWireResponseSchema,
  manifest: plainObjectSchema,
  manifestHash: nonEmptyStringSchema,
  state: plainObjectSchema,
});

export type ServedAccessManifestBundleWireResponse = z.infer<
  typeof ServedAccessManifestBundleWireResponseSchema
>;

const MANIFEST_FIELDS = [
  "version",
  "organizationId",
  "epoch",
  "previousManifestHash",
  "eventHash",
] as const;
const CONTAINER_BODY_FIELDS = [
  "containerKeyEpochId",
  "containerKeyPublicKey",
] as const;

function objectIdField(manifest: Record<string, unknown>): string | null {
  const objectKind = Reflect.get(manifest, "objectKind");
  if (objectKind === "container") return "containerId";
  if (objectKind === "document") return "documentId";
  return null;
}

/** The fields of `state` this bundle's own signed bytes name, by source. */
function signedStateFields(
  bundle: Pick<AccessManifestBundleWireResponse, "event" | "manifest">,
): readonly (readonly [string, Record<string, unknown>, string])[] {
  const { manifest } = bundle;
  const objectId = objectIdField(manifest);
  if (objectId === null) return [];
  const body = bundle.event.body;
  return [
    ...MANIFEST_FIELDS.map((field) => [field, manifest, field] as const),
    [objectId, manifest, "objectId"] as const,
    ...(objectId === "containerId" && isPlainObject(body)
      ? CONTAINER_BODY_FIELDS.map((field) => [field, body, field] as const)
      : []),
  ];
}

/** The bundle as served: its state without the fields its signed bytes name. */
export function toServedAccessManifestBundle(
  bundle: AccessManifestBundleWireResponse,
): ServedAccessManifestBundleWireResponse {
  const state = { ...bundle.state };
  for (const [field] of signedStateFields(bundle)) delete state[field];
  return {
    event: bundle.event,
    manifest: bundle.manifest,
    manifestHash: bundle.manifestHash,
    state,
  };
}

/**
 * The decoded bundle: the served state with every field its signed bytes
 * name taken from those bytes. A field the bytes lack stays absent, so the
 * verifier refuses the bundle as it would a malformed state.
 */
export function completeServedAccessManifestBundle(
  bundle: ServedAccessManifestBundleWireResponse,
): AccessManifestBundleWireResponse {
  const state: Record<string, unknown> = { ...bundle.state };
  for (const [field, source, key] of signedStateFields(bundle)) {
    const value = Reflect.get(source, key);
    if (value === undefined) delete state[field];
    else state[field] = value;
  }
  return { ...bundle, state };
}

export function isServedAccessManifestBundleWireResponse(
  value: unknown,
): value is ServedAccessManifestBundleWireResponse {
  return ServedAccessManifestBundleWireResponseSchema.safeParse(value).success;
}
