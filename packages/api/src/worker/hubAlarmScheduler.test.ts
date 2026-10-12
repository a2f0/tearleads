import { afterEach, expect, setSystemTime, test } from "bun:test";
import { HubAlarmScheduler } from "./hubAlarmScheduler";

afterEach(() => setSystemTime());
function fixture() {
  let alarm: number | null = null;
  const scheduler = new HubAlarmScheduler({
    getAlarm: async () => alarm,
    setAlarm: async (at) => {
      alarm = at;
    },
    deleteAlarm: async () => {
      alarm = null;
    },
  });
  return { scheduler, alarm: () => alarm };
}

test("persists the earliest check and removes the alarm when the last socket closes", async () => {
  setSystemTime(new Date(1000));
  const f = fixture();
  const cancelLater = f.scheduler.schedule(() => {}, 500);
  const cancelEarlier = f.scheduler.schedule(() => {}, 100);
  await f.scheduler.flush();
  expect(f.alarm()).toBe(1100);
  cancelEarlier();
  await f.scheduler.flush();
  expect(f.alarm()).toBe(1500);
  cancelLater();
  await f.scheduler.flush();
  expect(f.alarm()).toBeNull();
});

test("a slow periodic check cannot hold back a due authorization deadline", async () => {
  setSystemTime(new Date(1000));
  const f = fixture();
  const read = Promise.withResolvers<void>();
  let expired = false;
  f.scheduler.schedule(() => read.promise, 100);
  f.scheduler.schedule(() => {
    expired = true;
  }, 200);
  setSystemTime(new Date(1200));
  const checks = f.scheduler.runDue();
  expect(expired).toBe(true);
  read.resolve();
  await checks;
});

test("cancelled work cannot fire from an already collected alarm batch", async () => {
  const f = fixture();
  let calls = 0;
  f.scheduler.schedule(() => cancel(), 0);
  const cancel = f.scheduler.schedule(() => {
    calls++;
  }, 0);
  await f.scheduler.runDue();
  expect(calls).toBe(0);
});

test("deadlines still wake while an alarm's asynchronous work is outstanding", async () => {
  const f = fixture();
  const woke = Promise.withResolvers<void>();
  const leave = f.scheduler.enter(() => {
    void f.scheduler.runDue();
  });
  try {
    f.scheduler.schedule(() => woke.resolve(), 1);
    await woke.promise;
  } finally {
    leave();
  }
  await f.scheduler.flush();
  expect(f.alarm()).toBeNull();
});
