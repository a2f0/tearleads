import { afterEach, expect, spyOn, test } from "bun:test";
import { addListener, publish, resetPubSub } from "./pubSub";

const event = {
  type: "user_registered",
  userId: "user",
  fingerprint: "fingerprint",
} as const;

afterEach(() => {
  resetPubSub();
});

test("a publish reaches every listener in process, past a throwing one", async () => {
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  const received: string[] = [];
  addListener(() => {
    throw new Error("listener failed");
  });
  addListener((message) => received.push(message));

  await publish(event);

  expect(received).toEqual([JSON.stringify(event)]);
  expect(consoleError).toHaveBeenCalledTimes(1);
  consoleError.mockRestore();
});

test("an unsubscribed listener receives nothing", async () => {
  const received: string[] = [];
  const unsubscribe = addListener((message) => received.push(message));
  unsubscribe();

  await publish(event);

  expect(received).toEqual([]);
});
