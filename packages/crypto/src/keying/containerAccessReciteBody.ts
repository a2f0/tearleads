import { assertExactKeys, readString } from "./shared";
import type {
  ContainerReciteAccessEventBody,
  KeyingCanonicalJson,
} from "./types";

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
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "container.recite event body",
    ),
  };
}
