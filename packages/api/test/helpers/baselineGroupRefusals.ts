// Groups that each break one rotation baseline group rule, with the
// refusal each draws on either rotation path.
import { expect } from "bun:test";
import { compareCanonicalStrings } from "@tearleads/crypto";
import {
  decodeVersionVector,
  emptyVersionVector,
  encodeVersionVectorCounters,
  mergeVersionVectors,
} from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import {
  type History,
  storedHeaderCount,
  storedUpdates,
} from "./baselineGroupRouteKit";
import {
  type BaselineSegmentRange,
  baselineSegmentRanges,
  createSignedBaselineGroup,
} from "./documentBaselineGroups";

/** One range per peer of `frontier`, in canonical peer order. */
export function peerRanges(frontier: string): BaselineSegmentRange[] {
  return [...decodeVersionVector(frontier).toJSON()]
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
    .map(([peer, end]) => ({
      partialEndVersionVector: encodeVersionVectorCounters({ [peer]: end }),
      partialStartVersionVector: emptyVersionVector(),
    }));
}

/** The one peer a range of `peerRanges` names. */
function peerOf(range: BaselineSegmentRange): string {
  const [peer] = decodeVersionVector(range.partialEndVersionVector)
    .toJSON()
    .keys();
  if (peer === undefined) throw new Error("Expected a peer");
  return peer;
}

export type SignGroup = (
  options: Pick<
    Parameters<typeof createSignedBaselineGroup>[0],
    "baselineId" | "coversThroughUpdateId" | "override" | "ranges"
  >,
) => Promise<DocumentOutgoingUpdate[]>;

export interface RefusedGroup {
  readonly name: string;
  /** Builds the baseline the request carries. */
  readonly baseline: (input: {
    readonly frontier: string;
    readonly sign: SignGroup;
  }) => Promise<DocumentOutgoingUpdate[]>;
  readonly reason: string;
}

const NOT_GAPLESS =
  "the segments do not carry each peer's operations gapless from zero, each depending only on earlier segments";

/**
 * Each group rule, broken alone in a group that is otherwise authentic, is
 * signed by the document's writer, and reaches the committed frontier.
 */
export const REFUSED_GROUPS: readonly RefusedGroup[] = [
  {
    name: "segments out of index order",
    baseline: async ({ frontier, sign }) => {
      const [first, second, third] = await sign({
        ranges: peerRanges(frontier),
      });
      if (!first || !second || !third) throw new Error("Expected three");
      return [second, first, third];
    },
    reason: "the segments are not in index order from zero",
  },
  {
    name: "a missing middle segment",
    baseline: async ({ frontier, sign }) => {
      const [first, , third] = await sign({ ranges: peerRanges(frontier) });
      if (!first || !third) throw new Error("Expected three");
      return [first, third];
    },
    reason: "the segments are not in index order from zero",
  },
  {
    name: "a missing final segment",
    baseline: async ({ frontier, sign }) =>
      (await sign({ ranges: peerRanges(frontier) })).slice(0, 2),
    reason: "the final segment's count is not the number of segments",
  },
  {
    name: "a wrong count",
    baseline: ({ frontier, sign }) =>
      sign({
        override: (fields) =>
          fields.baselineSegmentCount === undefined
            ? fields
            : { ...fields, baselineSegmentCount: 4 },
        ranges: peerRanges(frontier),
      }),
    reason: "the final segment's count is not the number of segments",
  },
  {
    name: "a wrong digest",
    baseline: ({ frontier, sign }) =>
      sign({
        override: (fields) =>
          fields.baselineSegmentsDigest === undefined
            ? fields
            : { ...fields, baselineSegmentsDigest: "0".repeat(64) },
        ranges: peerRanges(frontier),
      }),
    reason: "the final segment's digest does not match the segments before it",
  },
  {
    name: "segments of two baselines",
    baseline: ({ frontier, sign }) =>
      sign({
        override: (fields, position) =>
          position === 1
            ? { ...fields, baselineId: crypto.randomUUID() }
            : fields,
        ranges: peerRanges(frontier),
      }),
    reason: "the segments name more than one baseline",
  },
  {
    name: "a gap in a peer's spans",
    baseline: ({ frontier, sign }) => {
      const [first, second, third] = peerRanges(frontier);
      if (!first || !second || !third) throw new Error("Expected three");
      // The second peer's span starts at 1, not zero. It still reaches its
      // end, so the group claims the same coverage.
      return sign({
        ranges: [
          first,
          {
            ...second,
            dependencyVersionVector: emptyVersionVector(),
            partialStartVersionVector: encodeVersionVectorCounters({
              [peerOf(second)]: 1,
            }),
          },
          third,
        ],
      });
    },
    reason: NOT_GAPLESS,
  },
  {
    name: "a dependency after its dependent",
    baseline: ({ frontier, sign }) => {
      const [first, second, third] = peerRanges(frontier);
      if (!first || !second || !third) throw new Error("Expected three");
      // The first segment depends on an operation the second one brings.
      return sign({
        ranges: [
          {
            ...first,
            dependencyVersionVector: encodeVersionVectorCounters({
              [peerOf(second)]: 1,
            }),
          },
          second,
          third,
        ],
      });
    },
    reason: NOT_GAPLESS,
  },
  {
    name: "peers named at their ends with no span",
    baseline: ({ frontier, sign }) => {
      const [first, ...others] = peerRanges(frontier);
      if (!first || others.length === 0) throw new Error("Expected peers");
      // One segment carries the first peer alone and names every other
      // peer at its committed end, so its end vector reaches the frontier.
      return sign({
        ranges: [
          {
            dependencyVersionVector: emptyVersionVector(),
            partialEndVersionVector: frontier,
            partialStartVersionVector: mergeVersionVectors(
              others.map((range) => range.partialEndVersionVector),
            ),
          },
        ],
      });
    },
    reason: NOT_GAPLESS,
  },
  {
    name: "a cursored baseline that names the frontier with no span",
    baseline: ({ frontier, sign }) =>
      sign({
        coversThroughUpdateId: "9e7c4d7a-1b2c-4d3e-8f90-a1b2c3d4e5f6",
        ranges: [
          {
            dependencyVersionVector: emptyVersionVector(),
            partialEndVersionVector: frontier,
            partialStartVersionVector: frontier,
          },
        ],
      }),
    reason: NOT_GAPLESS,
  },
  {
    name: "an empty baseline with no cursor",
    baseline: ({ sign }) => sign({ ranges: baselineSegmentRanges("AA==") }),
    reason:
      "a baseline with no operations is one segment that signs a processed cursor",
  },
];

export function signerFor(
  history: History,
  at: {
    readonly accessManifestHash: string;
    readonly contentKeyEpoch: number;
    readonly dependencyManifestHashes: readonly string[];
    readonly targetHash: string;
  },
): SignGroup {
  return (options) =>
    createSignedBaselineGroup({
      ...at,
      documentId: history.created.id,
      organizationId: String(
        Reflect.get(history.created.accessManifest.state, "organizationId"),
      ),
      owner: history.owner,
      ...options,
    });
}

/** What a refused request must leave: the rows and headers it found. */
export async function expectNothingWritten(history: History): Promise<void> {
  const ids = history.committed.map((update) => update.id);
  expect(
    (await storedUpdates(history.created.id)).map((row) => row.id),
  ).toEqual(ids);
  expect(await storedHeaderCount(history.created.id)).toBe(ids.length);
}
