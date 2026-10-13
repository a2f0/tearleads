import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createDomainScope } from "../domainScope";
import { getOrCreateDomainSyncCoordinator } from "./syncCoordinator";

function gate() {
  let open = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, wait };
}

test("four document workers fill independently and never overlap the same lane", async () => {
  const coordinator = getOrCreateDomainSyncCoordinator(createDomainScope());
  const gates = Array.from({ length: 6 }, gate);
  const started: number[] = [];
  let active = 0;
  let peak = 0;
  const lanes = gates.map((release, index) =>
    coordinator.registerLane(`doc-${index}`, {
      run: async () => {
        started.push(index);
        peak = Math.max(peak, ++active);
        await release.wait;
        active -= 1;
      },
    }),
  );
  try {
    lanes[0]?.requestSync();
    await waitFor(() => started.length === 1, "first worker did not start");
    // Requests arriving during an in-flight run must fill the remaining slots.
    coordinator.requestAllLanes();
    await waitFor(() => started.length === 4, "document workers stayed serial");
    expect(started).toEqual([0, 1, 2, 3]);
    gates[1]?.open();
    await waitFor(
      () => started.length === 5,
      "free worker did not drain next document",
    );
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(4);
  } finally {
    for (const release of gates) release.open();
  }
  expect(await coordinator.waitForIdle()).toBe(true);
  expect(started.filter((index) => index === 0)).toHaveLength(2);
  expect(peak).toBe(4);
});

test("a structural request drains running documents before admitting more", async () => {
  const coordinator = getOrCreateDomainSyncCoordinator(createDomainScope());
  const documents = gate();
  const structure = gate();
  const started: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    coordinator
      .registerLane(`doc-${index}`, {
        run: async () => {
          started.push(`doc-${index}`);
          await documents.wait;
        },
      })
      .requestSync();
  }
  const structural = coordinator.registerLane("structure", {
    phase: "structural",
    run: async () => {
      started.push("structure");
      await structure.wait;
    },
  });
  try {
    await waitFor(() => started.length === 4, "workers did not fill");
    structural.requestSync();
    expect(started).not.toContain("structure");
    documents.open();
    await waitFor(
      () => started.includes("structure"),
      "structural work did not start",
    );
    expect(started).toEqual(["doc-0", "doc-1", "doc-2", "doc-3", "structure"]);
  } finally {
    documents.open();
    structure.open();
  }
  expect(await coordinator.waitForIdle()).toBe(true);
  expect(started.slice(5)).toEqual(["doc-4", "doc-5"]);
});

test("one failing document does not back off healthy documents", async () => {
  const coordinator = getOrCreateDomainSyncCoordinator(createDomainScope());
  let attempts = 0;
  let completed = 0;
  const failing = coordinator.registerLane("failing", {
    onUnexpectedError: () => {},
    run: async () => {
      attempts += 1;
      failing.requestSync();
      throw new Error("retry");
    },
  });
  failing.requestSync();
  for (let index = 0; index < 10; index += 1) {
    coordinator
      .registerLane(`healthy-${index}`, {
        run: async () => {
          completed += 1;
        },
      })
      .requestSync();
  }
  try {
    await waitFor(
      () => completed === 10,
      "a failed lane stalled healthy documents",
      300,
    );
    expect(attempts).toBe(1);
    failing.requestSync();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(attempts).toBe(1);
  } finally {
    coordinator.dispose();
  }
});

test("hint priority wins and a rearming lane yields to fresh documents", async () => {
  const coordinator = getOrCreateDomainSyncCoordinator(createDomainScope());
  const started: string[] = [];
  const release = gate();
  for (let index = 0; index < 8; index += 1) {
    coordinator
      .registerLane(`backfill-${index}`, {
        run: async () => {
          started.push(`backfill-${index}`);
          await release.wait;
        },
      })
      .requestSync();
  }
  coordinator
    .registerLane("hinted", {
      priority: () => -1,
      run: async () => {
        started.push("hinted");
      },
    })
    .requestSync();
  try {
    await waitFor(() => started.length >= 4, "priority work did not start");
    expect(started[0]).toBe("hinted");
  } finally {
    release.open();
  }
  expect(await coordinator.waitForIdle()).toBe(true);
});
