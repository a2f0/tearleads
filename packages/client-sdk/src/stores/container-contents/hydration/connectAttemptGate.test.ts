import { expect, test } from "bun:test";
import {
  ConnectAttemptGate,
  owesAcknowledgedCrawl,
} from "./connectAttemptGate";

/**
 * A gate over a store whose connection the test sets. `owed` and `crawling`
 * describe the crawl an acknowledged connection owes; `current` whether
 * that acknowledgement is still current.
 */
function createGate(pendingConnectAttempt?: number) {
  const connection = {
    crawling: false,
    current: true,
    owed: false,
    pendingConnectAttempt,
  };
  const store = {
    reconnectRefresh: {
      get crawling() {
        return connection.crawling;
      },
      get owesCrawl() {
        return connection.owed;
      },
    },
    runtime: {
      isAcknowledgementCurrent: () => connection.current,
      state: {
        get serverEventsPendingConnectAttempt() {
          return connection.pendingConnectAttempt;
        },
      },
    },
  };
  const runs: string[] = [];
  const restored: Array<Promise<void>> = [];
  const gate = new ConnectAttemptGate(store, (crawl) => restored.push(crawl));
  const crawl = (name: string) => async () => {
    runs.push(name);
  };
  /** The acknowledgement: the attempt settles and its crawl is owed. */
  const acknowledge = () => {
    connection.pendingConnectAttempt = undefined;
    connection.owed = true;
    gate.observe();
  };
  return { acknowledge, connection, crawl, gate, restored, runs, store };
}

/** Whether `wait` has settled once queued microtasks ran. */
async function isSettled(wait: Promise<void> | null): Promise<boolean> {
  if (!wait) throw new Error("expected the crawl to wait");
  let settled = false;
  void wait.then(() => {
    settled = true;
  });
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  return settled;
}

test("an owed crawl vouches only while its acknowledgement is current", () => {
  const { connection, store } = createGate();
  expect(owesAcknowledgedCrawl(store)).toBe(false);
  connection.owed = true;
  expect(owesAcknowledgedCrawl(store)).toBe(true);
  connection.current = false;
  expect(owesAcknowledgedCrawl(store)).toBe(false);
});

test("with no connect attempt pending the crawl runs at once", () => {
  const { crawl, gate, runs } = createGate();
  expect(gate.hold(crawl("regained"))).toBeNull();
  // The caller runs it: the gate holds nothing.
  expect(runs).toEqual([]);
});

test.each([
  ["ends", undefined],
  ["is replaced by a retry", 8],
])(
  "a held crawl runs once its attempt %s unacknowledged",
  async (_name, next) => {
    const { connection, crawl, gate, restored, runs } = createGate(7);
    const wait = gate.hold(crawl("regained"));
    gate.observe();
    expect(await isSettled(wait)).toBe(false);
    expect(runs).toEqual([]);

    connection.pendingConnectAttempt = next;
    gate.observe();
    expect(await isSettled(wait)).toBe(true);
    expect(runs).toEqual(["regained"]);
    // The caller awaits it: it is not handed to the restored-crawl observer.
    expect(restored).toHaveLength(0);
  },
);

test("a crawl requested while one is held joins it", async () => {
  const { connection, crawl, gate, runs } = createGate(7);
  const first = gate.hold(crawl("first"));
  const second = gate.hold(crawl("second"));
  expect(second).toBe(first);
  connection.pendingConnectAttempt = undefined;
  gate.observe();
  expect(await isSettled(second)).toBe(true);
  expect(runs).toEqual(["first"]);
});

test("a held crawl yields to the acknowledgement and is dropped once its crawl completes", async () => {
  const { acknowledge, connection, crawl, gate, runs } = createGate(7);
  const wait = gate.hold(crawl("regained"));
  acknowledge();
  // It no longer counts as hydrating: the acknowledged crawl lists.
  expect(await isSettled(wait)).toBe(true);
  // A crawl requested meanwhile joins the yielded one.
  expect(await isSettled(gate.hold(crawl("again")))).toBe(true);

  connection.owed = false;
  gate.observe();
  connection.current = false;
  gate.observe();
  expect(runs).toEqual([]);
});

test("a yielded crawl is restored once the acknowledgement is lost", async () => {
  const { acknowledge, connection, crawl, gate, restored, runs } =
    createGate(7);
  gate.hold(crawl("regained"));
  acknowledge();

  // Lost while the acknowledged crawl lists: its answer is awaited first.
  connection.crawling = true;
  connection.current = false;
  gate.observe();
  expect(runs).toEqual([]);

  // That crawl backs off, still owed, and cannot run again until a new
  // acknowledgement.
  connection.crawling = false;
  gate.observe();
  expect(runs).toEqual(["regained"]);
  expect(restored).toHaveLength(1);
  gate.observe();
  expect(runs).toEqual(["regained"]);
});

test("a superseded crawl parked behind the acknowledged crawl is restored if it is lost", () => {
  const { connection, crawl, gate, restored, runs } = createGate();
  connection.owed = true;
  gate.park(crawl("superseded"));
  gate.observe();
  expect(runs).toEqual([]);

  connection.current = false;
  gate.observe();
  expect(runs).toEqual(["superseded"]);
  expect(restored).toHaveLength(1);
});

test("a reset runs a waiting crawl's retry and drops a yielded one", async () => {
  const waiting = createGate(7);
  const wait = waiting.gate.hold(waiting.crawl("regained"));
  waiting.gate.reset();
  expect(await isSettled(wait)).toBe(true);
  expect(waiting.runs).toEqual(["regained"]);

  const yielded = createGate(7);
  yielded.gate.hold(yielded.crawl("regained"));
  yielded.acknowledge();
  yielded.gate.reset();
  yielded.connection.current = false;
  yielded.gate.observe();
  expect(yielded.runs).toEqual([]);
});
