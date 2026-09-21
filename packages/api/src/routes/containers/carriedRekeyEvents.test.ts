import { expect, test } from "bun:test";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import { publishCarriedContainerRekeys } from "./mutationEvents";

// Each carried descendant rekey moved a head of its own, so dependents must be
// told to drop projections that cite it. A rekey never re-parents, so unlike a
// move's hint there is no previous parent to name.

test("every carried rekey publishes its own container hint", async () => {
  const published: PublishedRealtimeEvent[] = [];
  await publishCarriedContainerRekeys({
    carried: [
      { containerId: "upper", parentId: "root", updatedAt: "2026-01-01" },
      { containerId: "lower", parentId: "upper", updatedAt: "2026-01-02" },
    ],
    origin: { sessionId: "session", userId: "user" },
    publish: async (event) => {
      published.push(event);
    },
  });
  expect(published).toEqual([
    {
      containerId: "upper",
      eventType: "container.rekey",
      origin: { sessionId: "session", userId: "user" },
      parentId: "root",
      type: "container_mutation_created",
      updatedAt: "2026-01-01",
    },
    {
      containerId: "lower",
      eventType: "container.rekey",
      origin: { sessionId: "session", userId: "user" },
      parentId: "upper",
      type: "container_mutation_created",
      updatedAt: "2026-01-02",
    },
  ]);
});

test("a rotation that carried nothing publishes nothing extra", async () => {
  const published: PublishedRealtimeEvent[] = [];
  await publishCarriedContainerRekeys({
    carried: [],
    origin: { sessionId: "session", userId: "user" },
    publish: async (event) => {
      published.push(event);
    },
  });
  expect(published).toEqual([]);
});
