import { expect, test } from "bun:test";
import { scopeHintToInterest } from "./hintScoping";

for (const eventType of [
  "container.create",
  "container.move",
  "container.rekey",
]) {
  test(`parent-only ${eventType} hints carry no child details`, () => {
    const event = {
      type: "container_mutation_created" as const,
      containerId: "child",
      parentId: "destination",
      previousParentId: "source",
      eventType,
      updatedAt: "2026-09-23T00:00:00.000Z",
      origin: { userId: "author", sessionId: "private-session" },
    };
    expect(
      scopeHintToInterest(event, new Set(["source", "destination"])),
    ).toEqual({
      type: "container_children_changed",
      containerIds: ["destination", "source"],
    });
    expect(
      scopeHintToInterest(event, new Set(["child", "destination"])),
    ).toEqual({
      type: "container_mutation_created",
      containerId: "child",
      parentId: "destination",
      eventType,
      updatedAt: event.updatedAt,
    });
    expect(
      scopeHintToInterest(
        { ...event, previousParentId: "destination" },
        new Set(["destination"]),
      ),
    ).toEqual({
      type: "container_children_changed",
      containerIds: ["destination"],
    });
  });
}
