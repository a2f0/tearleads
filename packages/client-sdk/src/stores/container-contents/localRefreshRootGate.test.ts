import { expect, mock, test } from "bun:test";
import { rememberDestinationRole } from "../../workflows/container-contents/remoteHydration/destinationRoleCache";
import { refreshLocalContainerStates } from "./localRefresh";
import {
  createRefreshState,
  createTreeContainerState,
} from "./localRefresh.testFixtures";

// A projection request that never answers: the local refresh must not depend
// on it at all, let alone wait for it.
function stalledProjectionApi() {
  const getContainerWriterProjection = mock(() => new Promise<never>(() => {}));
  return { getContainerWriterProjection };
}

const remoteRoot = () =>
  createTreeContainerState({ id: "remote-root", parentId: null, remote: true });

test("a local refresh with a cold role cache and no local roots issues no request", async () => {
  const apiClient = stalledProjectionApi();
  const updateSnapshot = mock(() => {});
  const state = createRefreshState({
    apiClient,
    containersById: new Map([["remote-root", remoteRoot()]]),
    loadContainers: async () => [],
  });

  await refreshLocalContainerStates({ host: { updateSnapshot }, state });

  expect(updateSnapshot).toHaveBeenCalledTimes(1);
  expect(apiClient.getContainerWriterProjection).toHaveBeenCalledTimes(0);
}, 2_000);

test("a local refresh leaves the root merge pending until remote hydration has cached the role", async () => {
  const apiClient = stalledProjectionApi();
  const updateSnapshot = mock(() => {});
  const rootReconciliations = mock(async () => {});
  const root = remoteRoot();
  const localRoot = createTreeContainerState({
    id: "local-root",
    parentId: null,
    remote: false,
  });
  const state = createRefreshState({
    apiClient,
    containersById: new Map([["remote-root", root]]),
    loadContainers: async () => [
      { container: localRoot.container, record: null },
    ],
    reconcileLocalRootContainer: rootReconciliations,
  });

  // Cold cache: the refresh completes and publishes without a request, and the
  // pre-login local root stays where it is.
  await refreshLocalContainerStates({ host: { updateSnapshot }, state });
  expect(updateSnapshot).toHaveBeenCalledTimes(1);
  expect(apiClient.getContainerWriterProjection).toHaveBeenCalledTimes(0);
  expect(rootReconciliations).toHaveBeenCalledTimes(0);
  expect(state.containersById.has("local-root")).toBe(true);

  // Remote hydration verified the root (created by the session user) and
  // cached its role; the next local refresh reconciles from that cache.
  rememberDestinationRole(state.runtime.infra.execSql, root.container, {
    createSignerUserId: "user-1",
    metadataDocumentId: "remote-root-metadata",
    parentId: null,
    systemSlot: null,
  });
  state.localContainersNeedRefresh = true;
  await refreshLocalContainerStates({ host: { updateSnapshot }, state });
  expect(rootReconciliations).toHaveBeenCalledTimes(1);
  expect(state.containersById.has("local-root")).toBe(false);
  expect(apiClient.getContainerWriterProjection).toHaveBeenCalledTimes(0);
}, 2_000);
