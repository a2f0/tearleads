import { expect, mock, spyOn, test } from "bun:test";
import type { AccessEventType } from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import { publishContainerMutationCreated } from "./mutationEvents";

const request = {
  body: { eventType: "container.create" },
} as unknown as ContainerMutationRequest;

const response = {
  containerId: "container-1",
  parentId: null,
  updatedAt: "2026-07-17T12:00:00.000Z",
} as unknown as ContainerMutationResponse;

const ORIGIN = { sessionId: "session-1", userId: "user-1" };

function mutationRequest(body: Record<string, unknown>) {
  return { body } as unknown as ContainerMutationRequest;
}

async function publishedTypes(
  eventType: AccessEventType,
  body: Record<string, unknown> = { eventType },
  resolveGroupMemberUserIds?: (groupId: string) => Promise<readonly string[]>,
): Promise<PublishedRealtimeEvent[]> {
  const events: PublishedRealtimeEvent[] = [];
  await publishContainerMutationCreated({
    expectedEventType: eventType,
    origin: ORIGIN,
    publish: async (event) => {
      events.push(event);
    },
    request: mutationRequest(body),
    ...(resolveGroupMemberUserIds ? { resolveGroupMemberUserIds } : {}),
    response,
  });
  return events;
}

for (const eventType of ["container.revoke", "container.move"] as const) {
  test(`${eventType} evicts subscribers before the hint is published`, async () => {
    expect(
      (await publishedTypes(eventType)).map((event) => event.type),
    ).toEqual(["access_changed", "container_mutation_created"]);
  });
}

for (const eventType of [
  "container.create",
  "container.grant",
  "container.recite",
  "container.rekey",
] as const) {
  test(`${eventType} does not evict subscribers`, async () => {
    expect(
      (await publishedTypes(eventType)).filter(
        (event) => event.type === "access_changed",
      ),
    ).toEqual([]);
  });
}

test("a user grant notifies exactly that user", async () => {
  const events = await publishedTypes("container.grant", {
    eventType: "container.grant",
    grant: { subjectType: "user", subjectId: "reader" },
  });
  expect(events.filter((event) => event.type === "shared_with_you")).toEqual([
    { type: "shared_with_you", userId: "reader" },
  ]);
});

test("a group grant notifies every current member of the group", async () => {
  const resolved: string[] = [];
  const events = await publishedTypes(
    "container.grant",
    {
      eventType: "container.grant",
      grant: { subjectType: "group", subjectId: "group-1" },
    },
    async (groupId) => {
      resolved.push(groupId);
      return ["member-a", "member-b"];
    },
  );
  expect(resolved).toEqual(["group-1"]);
  expect(events.map((event) => event.type)).toEqual([
    "container_mutation_created",
    "shared_with_you",
    "shared_with_you",
  ]);
  expect(
    events.flatMap((event) =>
      event.type === "shared_with_you" ? [event.userId] : [],
    ),
  ).toEqual(["member-a", "member-b"]);
});

test("a failed group membership lookup still publishes the committed hint", async () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const events = await publishedTypes(
      "container.grant",
      {
        eventType: "container.grant",
        grant: { subjectType: "group", subjectId: "group-1" },
      },
      async () => {
        throw new Error("membership projection unavailable");
      },
    );
    expect(events.map((event) => event.type)).toEqual([
      "container_mutation_created",
    ]);
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to resolve group grant recipients:",
      expect.any(Error),
    );
  } finally {
    errorSpy.mockRestore();
  }
});

test("committed container mutations survive publication failure", async () => {
  const publish = mock(async () => {
    throw new Error("broker unavailable");
  });
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

  try {
    await expect(
      publishContainerMutationCreated({
        expectedEventType: "container.create",
        origin: { sessionId: "session-1", userId: "user-1" },
        publish,
        request,
        response,
      }),
    ).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to publish container mutation notification:",
      expect.any(Error),
    );
  } finally {
    errorSpy.mockRestore();
  }
});
