import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { KeyingCanonicalJson } from "./canonicalJsonTypes";
import type { ContainerRekeyAccessEventBody } from "./containerAccessTypes";
import { normalizeContainerGrantPrincipalHeads } from "./containerGrantPrincipalHead";
import { normalizeContainerKekWrappingPublicKey } from "./containerKekWrapping";
import {
  assertExactKeys,
  readHashString,
  readNullableHashString,
  readString,
  throwVerification,
} from "./shared";

export function normalizeContainerRekeyAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerRekeyAccessEventBody {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "container.rekey event body must be a plain object",
    );
  }
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "containerKeyPublicKey",
      "eventType",
      "keyringHash",
      "parentManifestHash",
      "predecessorBridgeHash",
      "referencedPrincipalHeads",
    ],
    "container.rekey event body",
  );
  const referencedPrincipalHeads = record.referencedPrincipalHeads;
  if (!Array.isArray(referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      "container.rekey event body.referencedPrincipalHeads must be an array",
    );
  }

  const containerKeyPublicKey = normalizeContainerKekWrappingPublicKey(
    record.containerKeyPublicKey,
  );
  if (containerKeyPublicKey === null)
    throwVerification("invalid_shape", "Container rekey requires a public key");
  return {
    containerKeyPublicKey,
    eventType: "container.rekey",
    parentManifestHash: readNullableHashString(
      record,
      "parentManifestHash",
      "container.rekey event body",
    ),
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "container.rekey event body",
    ),
    keyringHash: readHashString(
      record,
      "keyringHash",
      "container.rekey event body",
    ),
    predecessorBridgeHash: readHashString(
      record,
      "predecessorBridgeHash",
      "container.rekey event body",
    ),
    referencedPrincipalHeads: normalizeContainerGrantPrincipalHeads(
      referencedPrincipalHeads,
    ),
  };
}
