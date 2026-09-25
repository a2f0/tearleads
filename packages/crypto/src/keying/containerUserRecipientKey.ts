import {
  assertExactKeys,
  readHashString,
  readString,
  throwVerification,
} from "./shared";
import type { ContainerUserRecipientKey } from "./types";

export function normalizeContainerUserRecipientKey(
  value: unknown,
): ContainerUserRecipientKey {
  const record = assertExactKeys(
    value,
    ["recipientKeyEpochId", "recipientKeyFingerprint", "userId"],
    "container user recipient key",
  );

  const key = {
    userId: readString(record, "userId", "container user recipient key"),
    recipientKeyEpochId: readString(
      record,
      "recipientKeyEpochId",
      "container user recipient key",
    ),
    recipientKeyFingerprint: readHashString(
      record,
      "recipientKeyFingerprint",
      "container user recipient key",
    ),
  };
  if (
    key.recipientKeyEpochId !==
    `user:${key.userId}:encapsulation:${key.recipientKeyFingerprint}`
  ) {
    throwVerification(
      "invalid_shape",
      "Container user recipient key epoch must match its user and fingerprint",
    );
  }
  return key;
}
