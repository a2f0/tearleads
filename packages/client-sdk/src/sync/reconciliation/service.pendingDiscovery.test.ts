import { expect, test } from "bun:test";
import { createReconciliationService } from "./service";
import {
  createGate,
  createReconciliationTestHost,
} from "./service.testFixtures";

for (const stop of [false, true]) {
  test(`partial discovery publishes its delta and schedules a scoped retry (stop=${stop})`, async () => {
    let calls = 0;
    let applied = 0;
    const firstApply = createGate();
    const service = createReconciliationService(
      createReconciliationTestHost({
        discoverContainerDocuments: async (_id, _onFull, onPending) => {
          calls++;
          if (calls === 1) onPending?.(50);
          return [];
        },
        applyReconciled: () => {
          applied++;
          firstApply.open();
        },
      }),
    );
    try {
      service.start();
      service.enqueueContainer("pending", "active", true);
      await firstApply.wait;
      expect(applied).toBe(1);
      if (stop) service.stop();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(calls).toBe(stop ? 1 : 2);
      expect(applied).toBe(stop ? 1 : 2);
    } finally {
      service.stop();
    }
  });
}
