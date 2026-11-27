import { describe, expect, test } from "bun:test";
import {
  type ConnectAttemptWait,
  type ConnectAttemptWaitEvent,
  NO_CONNECT_ATTEMPT_WAIT,
  transitionConnectAttemptWait,
} from "./connectAttemptWaitMachine";

type Wait = ConnectAttemptWait<string>;
type Event = ConnectAttemptWaitEvent<string>;

const NONE: Wait = NO_CONNECT_ATTEMPT_WAIT;
const WAITING: Wait = { attempt: 3, request: "held", status: "waiting" };
const YIELDED: Wait = { request: "held", status: "yielded" };

const hold = (pendingConnectAttempt: number | undefined): Event => ({
  pendingConnectAttempt,
  request: "new",
  type: "hold",
});
const observe = (
  pendingConnectAttempt: number | undefined,
  acknowledged = false,
): Event => ({ acknowledged, pendingConnectAttempt, type: "observe" });

describe("the connect attempt wait", () => {
  test.each<[string, Wait, Event, Wait, string | undefined]>([
    [
      "runs a request at once with no attempt pending",
      NONE,
      hold(undefined),
      NONE,
      "new",
    ],
    [
      "holds a request on the pending attempt",
      NONE,
      hold(3),
      { attempt: 3, request: "new", status: "waiting" },
      undefined,
    ],
    [
      "parks a superseded request behind owed work",
      NONE,
      { request: "new", type: "yield" },
      { request: "new", status: "yielded" },
      undefined,
    ],
    [
      "yields a held request to the acknowledgement",
      WAITING,
      observe(undefined, true),
      YIELDED,
      undefined,
    ],
    [
      "keeps waiting while its attempt is pending",
      WAITING,
      observe(3),
      WAITING,
      undefined,
    ],
    [
      "keeps waiting while its attempt is pending, whatever else is owed",
      WAITING,
      observe(3, true),
      WAITING,
      undefined,
    ],
    [
      "yields to work owed once its attempt was replaced",
      WAITING,
      observe(4, true),
      YIELDED,
      undefined,
    ],
    [
      "releases a request whose attempt ended",
      WAITING,
      observe(undefined),
      NONE,
      "held",
    ],
    [
      "releases a request whose attempt was replaced",
      WAITING,
      observe(4),
      NONE,
      "held",
    ],
    [
      "drops a yielded request its acknowledged work covered",
      YIELDED,
      { type: "covered" },
      NONE,
      undefined,
    ],
    [
      "restores a yielded request when the acknowledgement is lost",
      YIELDED,
      { type: "acknowledgementLost" },
      NONE,
      "held",
    ],
    [
      "releases a waiting request on a reset",
      WAITING,
      { type: "reset" },
      NONE,
      "held",
    ],
    [
      "drops a yielded request on a reset",
      YIELDED,
      { type: "reset" },
      NONE,
      undefined,
    ],
  ])("%s", (_name, state, event, next, released) => {
    expect(transitionConnectAttemptWait(state, event)).toEqual({
      released,
      state: next,
    });
  });

  test.each<[string, Wait, Event]>([
    ["a hold joins a waiting request", WAITING, hold(4)],
    ["a hold joins a yielded request", YIELDED, hold(undefined)],
    [
      "a yield joins a waiting request",
      WAITING,
      { request: "new", type: "yield" },
    ],
    [
      "a yield joins a yielded request",
      YIELDED,
      { request: "new", type: "yield" },
    ],
    [
      "an observation does not end a yielded request",
      YIELDED,
      observe(undefined),
    ],
    ["an observation of nothing held", NONE, observe(undefined, true)],
    ["a waiting request is not covered", WAITING, { type: "covered" }],
    [
      "a waiting request is not restored",
      WAITING,
      { type: "acknowledgementLost" },
    ],
    ["nothing held is not restored", NONE, { type: "acknowledgementLost" }],
    ["a reset with nothing held", NONE, { type: "reset" }],
  ])("%s: the state is unchanged and nothing runs", (_name, state, event) => {
    const { released, state: next } = transitionConnectAttemptWait(
      state,
      event,
    );
    expect(released).toBeUndefined();
    expect(next).toEqual(event.type === "reset" ? NONE : state);
  });
});
