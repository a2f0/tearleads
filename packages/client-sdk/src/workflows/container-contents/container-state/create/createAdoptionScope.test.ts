import { expect, test } from "bun:test";
import {
  createAdoptionScenario,
  runListedCreateAdoption,
} from "../../../../../test/helpers/workflows/containerCreateAdoption";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../../test/helpers/workflows/expiringApiServer";

test.each(SCOPE_RETIREMENTS)(
  "an adoption read that expires after %s is not renewed or replayed",
  async (change) => {
    const { listedChild, parent } = await createAdoptionScenario();
    const child = await listedChild();
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/containers/${child.containerId}/writer-projection$`),
    });
    let current = true;
    try {
      const adopted = runListedCreateAdoption({
        intents: [{ containerId: child.containerId }],
        isCurrent: () => current,
        parent,
        read: server.api.getContainerWriterProjection,
        served: [child],
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      const result = await adopted;
      // A retired pass abandons the intent: nothing is adopted or recorded.
      expect(result.created).toBe(0);
      expect(result.recordedErrors).toEqual([]);
      expect(server.requests).toEqual([
        `GET /containers/${child.containerId}/writer-projection`,
      ]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
    }
  },
  15_000,
);
