import { expect, mock, spyOn, test } from "bun:test";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { publishContainerMutationCreated } from "./mutationEvents";

const request = {
  body: { eventType: "container.create" },
} as unknown as ContainerMutationRequest;

const response = {
  containerId: "container-1",
  parentId: null,
  updatedAt: "2026-07-17T12:00:00.000Z",
} as unknown as ContainerMutationResponse;

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
