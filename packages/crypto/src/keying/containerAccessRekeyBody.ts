import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { normalizeContainerGrantPrincipalHeads } from "./containerGrantPrincipalHead";
import {
  assertExactKeys,
  readHashString,
  readString,
  throwVerification,
} from "./shared";
import type {
  ContainerGrantPrincipalHead,
  ContainerRekeyAccessEventBody,
  KeyingCanonicalJson,
} from "./types";

/** Legacy rekeys omit principal heads and inherit them from the predecessor. */
export function normalizeContainerRekeyAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerRekeyAccessEventBody {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "container.rekey event body must be a plain object",
    );
  }
  const hasReferencedPrincipalHeads = Object.hasOwn(
    value,
    "referencedPrincipalHeads",
  );
  const record = assertExactKeys(
    value,
    hasReferencedPrincipalHeads
      ? [
          "containerKeyEpochId",
          "eventType",
          "keyringHash",
          "predecessorBridgeHash",
          "referencedPrincipalHeads",
        ]
      : [
          "containerKeyEpochId",
          "eventType",
          "keyringHash",
          "predecessorBridgeHash",
        ],
    "container.rekey event body",
  );
  const referencedPrincipalHeads = record.referencedPrincipalHeads;
  let normalizedReferencedPrincipalHeads:
    | ContainerGrantPrincipalHead[]
    | undefined;
  if (hasReferencedPrincipalHeads && !Array.isArray(referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      "container.rekey event body.referencedPrincipalHeads must be an array",
    );
  }
  if (Array.isArray(referencedPrincipalHeads)) {
    normalizedReferencedPrincipalHeads = normalizeContainerGrantPrincipalHeads(
      referencedPrincipalHeads,
    );
  }

  return {
    eventType: "container.rekey",
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
    ...(normalizedReferencedPrincipalHeads
      ? { referencedPrincipalHeads: normalizedReferencedPrincipalHeads }
      : {}),
  };
}
