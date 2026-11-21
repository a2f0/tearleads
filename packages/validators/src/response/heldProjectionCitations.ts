import type { ServedAccessManifestBundleWireResponse } from "../util";
import type { ContainerKekWireLevel } from "./container";
import {
  isPrincipalStatePayloadResponse,
  isPrincipalStateResponse,
  type PrincipalStatePayloadResponse,
  type PrincipalStateResponse,
} from "./principalSnapshot";

/**
 * Where a listing placed a container the device has not stored yet. Only
 * which held bytes a read cites depends on it, never what the read accepts.
 */
export interface WriterProjectionListing {
  readonly organizationId: string;
  readonly parentId: string | null;
}

/** The container or document whose writer projection a read requests. */
export interface WriterProjectionTarget {
  readonly kind: "container" | "document";
  readonly id: string;
  readonly listing?: WriterProjectionListing | undefined;
}

/**
 * An organization directory payload a device holds, beside the signed state
 * that commits its hash. Writer projections serve directory payloads as
 * policy evidence; a request may cite a held one by state hash instead.
 */
export interface HeldDirectoryCitation {
  readonly directoryState: PrincipalStateResponse;
  readonly directoryPayload: PrincipalStatePayloadResponse;
}

export function isHeldDirectoryCitation(
  value: unknown,
): value is HeldDirectoryCitation {
  return (
    typeof value === "object" &&
    value !== null &&
    isPrincipalStateResponse(Reflect.get(value, "directoryState")) &&
    isPrincipalStatePayloadResponse(Reflect.get(value, "directoryPayload"))
  );
}

/**
 * A held access-manifest bundle, a held container KEK level, or a held
 * organization directory payload with its signed state.
 */
export type HeldProjectionCitation =
  | ServedAccessManifestBundleWireResponse
  | ContainerKekWireLevel
  | HeldDirectoryCitation;

/**
 * The exact bytes one request cites: bundles by hash, levels by digest,
 * directory payloads by their organization state's hash. These are the held
 * maps the writer projection decoders fill omissions from.
 */
export interface HeldProjectionCitations {
  readonly bundles: ReadonlyMap<string, ServedAccessManifestBundleWireResponse>;
  readonly kekLevels: ReadonlyMap<string, ContainerKekWireLevel>;
  readonly directories: ReadonlyMap<string, PrincipalStatePayloadResponse>;
}
