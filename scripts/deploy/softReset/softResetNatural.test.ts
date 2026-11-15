import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { alive, waitFor } from "./softResetCancel.testUtils";
import { naturalFixture } from "./softResetNatural.testUtils";
import { transitionProcess } from "./softResetProcessState";

const observe = (now: number, groupAlive = true) =>
  ({ type: "observe", now, leaderClosed: true, groupAlive }) as const;

test("natural leader exit starts a fixed no-signal observation", () => {
  const observing = transitionProcess(
    { status: "running" },
    observe(20),
    "bounded-command",
  );
  expect<unknown>(observing).toEqual({ status: "observing", deadline: 1020 });
  expect(transitionProcess(observing, observe(1019), "bounded-command")).toBe(
    observing,
  );
  expect<unknown>(
    transitionProcess(observing, observe(1020), "bounded-command"),
  ).toEqual({
    status: "draining",
    reason: "descendants",
    deadline: 2020,
  });
});

test.each(["bounded-command", "terraform-state"] as const)(
  "%s automatic cleanup has fixed deadlines and a sticky failure reason",
  (policy) => {
    const grace = policy === "terraform-state" ? 60_000 : 1000;
    const observing = transitionProcess(
      { status: "running" },
      observe(20),
      policy,
    );
    const draining = transitionProcess(observing, observe(1020), policy);
    expect(draining).toEqual({
      status: "draining",
      reason: "descendants",
      deadline: 1020 + grace,
    });
    for (const now of [1020, 1021, 1019 + grace]) {
      expect(
        transitionProcess(draining, { type: "interrupt", now }, policy),
      ).toBe(draining);
      expect(transitionProcess(draining, observe(now), policy)).toBe(draining);
    }
    expect(transitionProcess(draining, observe(1021, false), policy)).toEqual({
      status: "settled",
      reason: "descendants",
    });
    const forcing = transitionProcess(draining, observe(1020 + grace), policy);
    expect(forcing).toEqual({
      status: "forcing",
      reason: "descendants",
      deadline: 2020 + grace,
    });
    expect(
      transitionProcess(
        forcing,
        { type: "interrupt", now: 1021 + grace },
        policy,
      ),
    ).toBe(forcing);
    expect(transitionProcess(forcing, observe(2019 + grace), policy)).toBe(
      forcing,
    );
    const settled = transitionProcess(forcing, observe(2020 + grace), policy);
    expect(settled).toEqual({ status: "settled", reason: "descendants" });
    expect(transitionProcess(settled, observe(999_999), policy)).toBe(settled);
    expect(
      transitionProcess(settled, { type: "interrupt", now: 999_999 }, policy),
    ).toBe(settled);
  },
);

test.each([
  ["bounded-command", 0],
  ["bounded-command", 7],
  ["terraform-state", 0],
  ["terraform-state", 7],
] as const)(
  "%s natural exit %s bounds noncooperative descendants and fails",
  async (policy, code) => {
    const f = await naturalFixture(policy, false, code);
    const signal = policy === "terraform-state" ? "SIGINT" : "SIGTERM";
    const deadline = policy === "terraform-state" ? 61_000 : 2000;
    try {
      expect(alive(f.pid)).toBe(true);
      expect(f.outcome()).toBeUndefined();
      await f.advance(999);
      expect(f.signals()).toBe("");
      await f.advance(1000);
      await waitFor(() => f.signals() !== "", 1000).catch(() => {});
      expect(f.signals()).toBe(`${signal}\n`);
      await f.advance(deadline - 1);
      // A later operator must neither send a second SIGINT nor restart grace.
      f.command.interrupt();
      f.command.interrupt();
      await f.advance(deadline - 1);
      expect(alive(f.pid)).toBe(true);
      expect(f.outcome()).toBeUndefined();
      expect(f.signals()).toBe(`${signal}\n`);
      await f.advance(deadline);
      await waitFor(() => !alive(f.pid), 1000).catch(() => {});
      expect(alive(f.pid)).toBe(false);
      await f.advance(deadline + 1000);
      expect(f.outcome()).toMatchObject({ error: expect.any(Error) });
      expect(f.stopped()).toBe(true);
    } finally {
      await f.cleanup();
    }
  },
  10_000,
);

test.each(["bounded-command", "terraform-state"] as const)(
  "%s cooperative cleanup still fails a zero-exit command",
  async (policy) => {
    const f = await naturalFixture(policy, true);
    try {
      await f.advance(1000);
      await waitFor(() => !alive(f.pid));
      await f.advance(1001);
      expect(f.signals()).toBe(
        policy === "terraform-state" ? "SIGINT\n" : "SIGTERM\n",
      );
      expect(f.outcome()).toMatchObject({ error: expect.any(Error) });
      expect(f.stopped()).toBe(true);
    } finally {
      await f.cleanup();
    }
  },
);

test("natural observation can become cancellation with a full Terraform grace", async () => {
  const f = await naturalFixture("terraform-state");
  try {
    await f.advance(999);
    f.command.interrupt();
    await waitFor(() => f.signals() !== "", 1000).catch(() => {});
    expect(f.signals()).toBe("SIGINT\n");
    await f.advance(60_998);
    f.command.interrupt();
    expect(alive(f.pid)).toBe(true);
    expect(f.outcome()).toBeUndefined();
    await f.advance(60_999);
    await waitFor(() => !alive(f.pid), 1000).catch(() => {});
    expect(alive(f.pid)).toBe(false);
    await f.advance(61_999);
    // Run-level cancellation, not an automatic-cleanup failure.
    expect(f.outcome()).toEqual({ code: 0 });
    expect(f.signals()).toBe("SIGINT\n");
  } finally {
    await f.cleanup();
  }
});

test.each([0, 7])(
  "ordinary descendant teardown preserves leader exit %s without signals",
  async (code) => {
    const f = await naturalFixture("terraform-state", false, code);

    try {
      f.release();
      await waitFor(() => !alive(f.pid));
      await f.advance(999);
      expect(f.outcome()).toEqual({ code });
      expect(f.signals()).toBe("");
      expect(f.stopped()).toBe(true);
      f.command.interrupt();
      await f.advance(99_999);
      expect(f.outcome()).toEqual({ code });
    } finally {
      await f.cleanup();
    }
  },
);

test("automatic cleanup signals only the owned process group", async () => {
  const f = await naturalFixture("bounded-command");
  const outsider = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { detached: true, stdio: "ignore" },
  );
  try {
    await f.advance(1000);
    await waitFor(() => f.signals() !== "");
    await f.advance(2000);
    await waitFor(() => !alive(f.pid));
    await f.advance(3000);
    expect(f.outcome()).toMatchObject({ error: expect.any(Error) });
    expect(outsider.pid && alive(outsider.pid)).toBe(true);
  } finally {
    outsider.kill("SIGKILL");
    await new Promise<void>((resolve) =>
      outsider.once("close", () => resolve()),
    );
    await f.cleanup();
  }
});
