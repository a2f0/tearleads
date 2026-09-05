import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { normalizeContainerGrantPrincipalHeads } from "./containerGrantPrincipalHead";
import {
  assertExactKeys,
  readHashString,
  readString,
  throwVerification,
} from "./shared";
import type {
  ContainerRekeyAccessEventBody,
  KeyingCanonicalJson,
} from "./types";

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
      "eventType",
      "keyringHash",
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
    referencedPrincipalHeads: normalizeContainerGrantPrincipalHeads(
      referencedPrincipalHeads,
    ),
  };
}
