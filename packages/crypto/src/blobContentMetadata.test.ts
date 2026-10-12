import { expect, test } from "bun:test";
import { blobContentMetadataHash } from "./blobContentMetadata";

// Fixed protocol vectors: changing the domain, framing version, geometry, or
// canonical serialization must not silently change client/server commitments.
test.each([
  [1, "ae56532476ce644fe9dbbe25bb5f28c0d83f02164c61099c808af9874ce7560c"],
  [2, "1459b47c944560107e0483bd222c25a00e799cd86243ffab172e0be9701433a1"],
] as const)(
  "blob metadata commitment at epoch %s",
  async (contentKeyEpoch, expected) => {
    expect(
      await blobContentMetadataHash({
        blobId: "550e8400-e29b-41d4-a716-446655440657",
        byteLength: 32,
        chunkCount: 1,
        chunkSize: 1048576,
        contentKeyEpoch,
      }),
    ).toBe(expected);
  },
);
