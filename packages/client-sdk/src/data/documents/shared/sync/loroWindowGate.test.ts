import { expect, test } from "bun:test";
import {
  LORO_WINDOW_GATE_IDLE,
  type LoroWindowGate,
  type LoroWindowGateEvent,
  loroGateHolders,
  transitionLoroWindowGate,
} from "./loroWindowGate";

function run(events: readonly LoroWindowGateEvent[]): LoroWindowGate {
  return events.reduce(transitionLoroWindowGate, LORO_WINDOW_GATE_IDLE);
}

const shared = (scope: string): LoroWindowGateEvent => ({
  type: "requested",
  waiter: { exclusive: false, scope },
});
const exclusive = (scope: string): LoroWindowGateEvent => ({
  type: "requested",
  waiter: { exclusive: true, scope },
});
const released = (scope: string): LoroWindowGateEvent => ({
  type: "released",
  scope,
});

test("shared scopes hold the gate together", () => {
  expect(loroGateHolders(run([shared("a"), shared("b")]))).toEqual(["a", "b"]);
});

test("an exclusive scope waits for the holders, and later scopes wait for it", () => {
  const waiting = run([shared("a"), exclusive("x"), shared("b")]);
  expect(loroGateHolders(waiting)).toEqual(["a"]);
  const alone = transitionLoroWindowGate(waiting, released("a"));
  expect(alone).toEqual({
    status: "exclusive",
    holder: "x",
    waiting: [{ exclusive: false, scope: "b" }],
  });
  expect(
    loroGateHolders(transitionLoroWindowGate(alone, released("x"))),
  ).toEqual(["b"]);
});

test("a repeated request changes nothing, and a waiter can leave the queue", () => {
  const gate = run([exclusive("x"), exclusive("x"), shared("b")]);
  expect(gate).toEqual({
    status: "exclusive",
    holder: "x",
    waiting: [{ exclusive: false, scope: "b" }],
  });
  expect(transitionLoroWindowGate(gate, released("b"))).toEqual({
    status: "exclusive",
    holder: "x",
    waiting: [],
  });
  expect(run([exclusive("x"), released("x")])).toEqual(LORO_WINDOW_GATE_IDLE);
});
