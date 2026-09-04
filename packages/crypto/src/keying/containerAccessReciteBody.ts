import { assertExactKeys, readNullableString } from "./shared";
import type {
  ContainerReciteAccessEventBody,
  KeyingCanonicalJson,
} from "./types";

// Re-citations may only consume the first quarter of the API verifier's 4096
// manifest budget. Ordinary mutations retain the remaining history capacity.
export const MAX_CONTAINER_RECITATION_EPOCH = 1024;

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
