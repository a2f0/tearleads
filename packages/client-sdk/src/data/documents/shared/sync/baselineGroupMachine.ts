/**
 * A reader's place in a rotation baseline while it pulls: the explicit state
 * machine behind `judgeServedBaselineGroups`. A baseline is an ordered group
 * of updates, its segments, committed together and served as ordinary
 * updates in commit order, so a group's segments arrive as one run, over as
 * many pages as they take.
 *
 * What a reader can hold a server to depends on what it asked for. A pull
 * sent with an empty version is served every segment of every group it
 * reaches, so a group that starts at index zero on such a pull is followed
 * whole: each next update must be the group's next segment, and the final
 * one must sign the count and the digest of the ones before it. The server
 * leaves out a segment whose operations the reader's version already holds,
 * so a reader that sent a version follows a group in part: indices only
 * rise, and a final segment's count must fit its index.
 */

/** A group followed whole so far: what must come next, and the digest. */
export interface BaselineGroupRun {
  readonly baselineId: string;
  /** The digest of the segments seen, which the final segment signs. */
  readonly digest: string;
  /** The index the next served update must have. */
  readonly nextIndex: number;
}

export type BaselineGroupFault =
  | "count_mismatch"
  | "digest_mismatch"
  | "final_missing"
  | "group_interrupted"
  | "mixed_baseline"
  | "segment_out_of_order";

export type BaselineGroupState =
  | { readonly status: "outside" }
  | ({ readonly status: "whole" } & BaselineGroupRun)
  | {
      readonly status: "partial";
      readonly baselineId: string;
      readonly lastIndex: number;
    }
  | { readonly status: "failed"; readonly fault: BaselineGroupFault };

/** The count and digest a final segment signs. */
interface BaselineGroupSeal {
  readonly count: number;
  readonly digest: string;
}

/**
 * The digest chain around one segment, worked out before the transition:
 * `before` is the digest of the segments before it, and `after` the digest
 * once it joins them, null on a final segment, which is not in its own
 * digest. Null when the reader does not hold the digest before it: the
 * segment neither starts a group nor continues the run being followed.
 */
export interface BaselineSegmentChain {
  readonly after: string | null;
  readonly before: string;
}

export type BaselineGroupEvent =
  | { readonly type: "ordinary_update" }
  | { readonly type: "pull_complete" }
  | {
      readonly type: "segment";
      readonly baselineId: string;
      readonly chain: BaselineSegmentChain | null;
      /** Whether the pull that served it was sent with an empty version. */
      readonly cold: boolean;
      readonly index: number;
      readonly seal: BaselineGroupSeal | null;
    };

type SegmentEvent = Extract<BaselineGroupEvent, { type: "segment" }>;

const OUTSIDE: BaselineGroupState = { status: "outside" };

function failed(fault: BaselineGroupFault): BaselineGroupState {
  return { fault, status: "failed" };
}

/** A segment met outside any group: one starts, or ends at once. */
function startGroup(event: SegmentEvent): BaselineGroupState {
  if (event.seal) {
    if (event.seal.count !== event.index + 1) return failed("count_mismatch");
    // A group of one segment signs the digest every group starts from.
    return event.index === 0 && event.seal.digest !== event.chain?.before
      ? failed("digest_mismatch")
      : OUTSIDE;
  }
  if (event.index === 0 && event.cold && event.chain?.after != null) {
    return {
      baselineId: event.baselineId,
      digest: event.chain.after,
      nextIndex: 1,
      status: "whole",
    };
  }
  return {
    baselineId: event.baselineId,
    lastIndex: event.index,
    status: "partial",
  };
}

function continueWhole(
  state: Extract<BaselineGroupState, { status: "whole" }>,
  event: SegmentEvent,
): BaselineGroupState {
  if (event.baselineId !== state.baselineId) return failed("mixed_baseline");
  if (event.index !== state.nextIndex) return failed("segment_out_of_order");
  if (event.seal) {
    if (event.seal.count !== state.nextIndex + 1) {
      return failed("count_mismatch");
    }
    return event.seal.digest === state.digest
      ? OUTSIDE
      : failed("digest_mismatch");
  }
  if (event.chain?.after == null) return failed("digest_mismatch");
  return {
    baselineId: state.baselineId,
    digest: event.chain.after,
    nextIndex: state.nextIndex + 1,
    status: "whole",
  };
}

function continuePartial(
  state: Extract<BaselineGroupState, { status: "partial" }>,
  event: SegmentEvent,
): BaselineGroupState {
  // The rest of the earlier group was held already; another one begins.
  if (event.baselineId !== state.baselineId) return startGroup(event);
  if (event.index <= state.lastIndex) return failed("segment_out_of_order");
  if (!event.seal) return { ...state, lastIndex: event.index };
  return event.seal.count === event.index + 1
    ? OUTSIDE
    : failed("count_mismatch");
}

function onSegment(
  state: BaselineGroupState,
  event: SegmentEvent,
): BaselineGroupState {
  switch (state.status) {
    case "outside":
      return startGroup(event);
    case "whole":
      return continueWhole(state, event);
    case "partial":
      return continuePartial(state, event);
    case "failed":
      return state;
  }
}

/**
 * The state after one served update, or after the server reports the pull
 * complete. A failure is final: the pass that reaches it fails.
 */
export function baselineGroupTransition(
  state: BaselineGroupState,
  event: BaselineGroupEvent,
): BaselineGroupState {
  if (state.status === "failed") return state;
  switch (event.type) {
    case "segment":
      return onSegment(state, event);
    case "ordinary_update":
      // A group's segments are committed together: nothing sits between
      // them, so an ordinary update ends a run followed in part and breaks
      // one followed whole.
      return state.status === "whole" ? failed("group_interrupted") : OUTSIDE;
    case "pull_complete":
      return state.status === "whole" ? failed("final_missing") : OUTSIDE;
  }
}

/** The state a pull page starts in, from the run its continuation carried. */
export function baselineGroupStateFromRun(
  run: BaselineGroupRun | null | undefined,
): BaselineGroupState {
  return run ? { ...run, status: "whole" } : OUTSIDE;
}

/** The run a continuation carries to the next page, if a group is open. */
export function baselineGroupRunOf(
  state: BaselineGroupState,
): BaselineGroupRun | null {
  return state.status === "whole"
    ? {
        baselineId: state.baselineId,
        digest: state.digest,
        nextIndex: state.nextIndex,
      }
    : null;
}
