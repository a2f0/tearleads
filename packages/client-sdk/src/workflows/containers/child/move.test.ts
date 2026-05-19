import { expect, test } from "bun:test";
import { moveRemoteContainer } from "@tearleads/client-sdk/workflows/containers";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  tamperFirstProjectionEventSignature,
} from "../../../../test/helpers/containerFixtures";

test("moveRemoteContainer rejects bad source projection signatures before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const tamperedProjection = tamperFirstProjectionEventSignature(
    parent.projection,
  );
  let moveCalled = false;

  await expect(
    moveRemoteContainer({
      apiClient: {
        getContainerWriterProjection: async (containerId) =>
          containerId === parent.projection.containerId
            ? tamperedProjection
            : parent.projection,
        moveContainer: async () => {
          moveCalled = true;
          throw new Error("Unexpected move call");
        },
      },
      author,
      containerId: parent.projection.containerId,
      destinationParentContainerId: "destination-parent",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow(
    "Container writer projection path[0] signature verification failed",
  );
  expect(moveCalled).toBe(false);
});

test("moveRemoteContainer rejects bad destination projection signatures before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const tamperedProjection = tamperFirstProjectionEventSignature(
    parent.projection,
  );
  let moveCalled = false;

  await expect(
    moveRemoteContainer({
      apiClient: {
        getContainerWriterProjection: async (containerId) =>
          containerId === parent.projection.containerId
            ? parent.projection
            : tamperedProjection,
        moveContainer: async () => {
          moveCalled = true;
          throw new Error("Unexpected move call");
        },
      },
      author,
      containerId: parent.projection.containerId,
      destinationParentContainerId: "tampered-destination-parent",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow(
    "Container writer projection path[0] signature verification failed",
  );
  expect(moveCalled).toBe(false);
});
