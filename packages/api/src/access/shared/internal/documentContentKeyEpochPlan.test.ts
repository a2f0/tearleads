import { expect, test } from "bun:test";
import { planDocumentContentKeyEpoch } from "./documentContentKeyEpochPlan";

const STALE = "Document content key epoch is stale";
const MUST_ROTATE =
  "Document content key epoch must rotate after target key material changes";

function plan(
  contentKeyEpoch: number,
  latestContentKeyEpoch: number | null,
  targetsStillCurrent: boolean,
): { readonly outcome: string; readonly targetChecks: number } {
  let targetChecks = 0;
  try {
    const { kind } = planDocumentContentKeyEpoch({
      contentKeyEpoch,
      latestContentKeyEpoch,
      latestTargetsStillCurrent: () => {
        targetChecks += 1;
        return targetsStillCurrent;
      },
    });
    return { outcome: kind, targetChecks };
  } catch (error) {
    expect(error).toMatchObject({ status: 409 });
    return {
      outcome: error instanceof Error ? error.message : String(error),
      targetChecks,
    };
  }
}

test.each<[number, number | null, boolean, string, number]>([
  [1, null, true, "first", 0],
  [1, null, false, "first", 0],
  [1, 2, true, STALE, 0],
  [1, 2, false, STALE, 0],
  [2, 2, true, "carry", 1],
  [2, 2, false, MUST_ROTATE, 1],
  [3, 2, true, "rotate", 0],
  [3, 2, false, "rotate", 0],
])(
  "epoch %p over latest %p (targets current: %p) -> %p",
  (epoch, latest, targetsStillCurrent, outcome, targetChecks) => {
    expect(plan(epoch, latest, targetsStillCurrent)).toEqual({
      outcome,
      targetChecks,
    });
  },
);
