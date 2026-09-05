import { assertExactKeys, readNullableString } from "./shared";
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
    ["containerKeyEpochId", "eventType"],
    "container.recite event body",
  );
  return {
    eventType: "container.recite",
    containerKeyEpochId: readNullableString(
      record,
      "containerKeyEpochId",
      "container.recite event body",
    ),
  };
}
