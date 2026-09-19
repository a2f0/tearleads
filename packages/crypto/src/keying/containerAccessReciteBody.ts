import { normalizeContainerKekWrappingPublicKey } from "./containerKekWrapping";
import {
  assertExactKeys,
  readNullableString,
  throwVerification,
} from "./shared";
import type {
  ContainerReciteAccessEventBody,
  KeyingCanonicalJson,
} from "./types";

// Reserve half of the API's 1024 same-KEK write-history budget and most of
// its 4096 projection-history budget for ordinary mutations. This absolute
// epoch ceiling does not reset when a container rekeys.
export const MAX_CONTAINER_RECITATION_EPOCH = 512;

export function normalizeContainerReciteAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerReciteAccessEventBody {
  const record = assertExactKeys(
    value,
    ["containerKeyEpochId", "containerKeyPublicKey", "eventType"],
    "container.recite event body",
  );
  const containerKeyPublicKey = normalizeContainerKekWrappingPublicKey(
    record.containerKeyPublicKey,
  );
  const containerKeyEpochId = readNullableString(
    record,
    "containerKeyEpochId",
    "container.recite event body",
  );
  if ((containerKeyEpochId === null) !== (containerKeyPublicKey === null)) {
    throwVerification(
      "invalid_shape",
      "Container KEK epoch and public key must both be present or both be null",
    );
  }
  return {
    eventType: "container.recite",
    containerKeyPublicKey,
    containerKeyEpochId,
  };
}
