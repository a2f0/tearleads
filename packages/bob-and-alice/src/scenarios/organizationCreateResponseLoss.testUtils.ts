import type { Device } from "../harness/device";
import type { ObservedRequest } from "../harness/transport";
import type { World } from "../harness/world";

const options = { organizationProfileName: "Lost create" };

function organizationCreate(request: ObservedRequest): boolean {
  return request.method === "POST" && request.path === "/organizations";
}

function requestIdentity(body: unknown) {
  if (
    typeof body !== "object" ||
    body === null ||
    !("organizationId" in body) ||
    typeof body.organizationId !== "string" ||
    !("rootContainerId" in body) ||
    typeof body.rootContainerId !== "string" ||
    "nativeSubscriptionRestore" in body ||
    "replacesOrganizationId" in body
  ) {
    throw new Error("Expected a plain organization create request");
  }
  return {
    organizationId: body.organizationId,
    containerId: body.rootContainerId,
  };
}

function headers(device: Device) {
  const token = device.sdk.session.authToken;
  if (!token) throw new Error("Expected a logged-in device");
  return { Authorization: `Bearer ${token}` };
}

async function membershipIds(device: Device): Promise<string[]> {
  const response = await fetch(
    `${device.transport.origin}/organization-memberships`,
    { headers: headers(device) },
  );
  if (response.status !== 200) {
    throw new Error(`Membership listing failed: ${response.status}`);
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("memberships" in body) ||
    !Array.isArray(body.memberships)
  ) {
    throw new Error("Expected organization memberships");
  }
  return body.memberships.map((row: unknown) => {
    if (
      typeof row !== "object" ||
      row === null ||
      !("organizationId" in row) ||
      typeof row.organizationId !== "string"
    ) {
      throw new Error("Expected an organization membership id");
    }
    return row.organizationId;
  });
}

async function discoverOrganizations(device: Device) {
  const tree = await device.tree();
  if (!(await tree.refreshRootLane())) {
    throw device.failure("root discovery failed");
  }
  await device.idle();
  return device.sdk.organizations.listLocalOrganizations();
}

/** All setup runs outside test.failing, so a broken fixture cannot satisfy it. */
export async function observeLostOrganizationCreate(
  world: World,
  restartBeforeRetry: boolean,
) {
  const user = await world.register("lost-create");
  let device = user.devices[0];
  if (!device) throw new Error("Expected an original device");
  const personalId = device.organizationId;
  const initialServerIds = await membershipIds(device);
  const beforeLoss = await device.sdk.organizations.listLocalOrganizations();
  const lost = device.transport.hold("after-response", organizationCreate);
  const pending = device.sdk.session.createOrganization(options);
  let committed: Awaited<ReturnType<typeof lost.wait>>;
  try {
    committed = await lost.wait();
  } finally {
    lost.drop();
  }
  const firstResult = await pending;
  if (committed.status !== 200) {
    throw device.failure(`create did not commit: ${committed.status}`);
  }
  const first = requestIdentity(committed.body);
  const afterLoss = await device.sdk.organizations.listLocalOrganizations();
  const afterCommitServerIds = await membershipIds(device);
  const hydrated = await discoverOrganizations(device);

  if (restartBeforeRetry) {
    device = await world.restartDevice(user, device);
  }
  const beforeRetry = await device.sdk.organizations.listLocalOrganizations();
  const retry = await device.sdk.session.createOrganization(options);
  if (!retry) throw device.failure("retry failed before comparison");
  const afterRetryServerIds = await membershipIds(device);
  const afterRetry = await discoverOrganizations(device);
  const requests = device.transport.history.filter(organizationCreate);
  const submitted = requests.map((request) => requestIdentity(request.body));
  const statuses = requests.map((request) => request.status);

  // This is an SDK-runtime restart over retained SQLite, not a connection reopen.
  device = await world.restartDevice(user, device);
  const afterRestart = await device.sdk.organizations.listLocalOrganizations();
  const afterRestartServerIds = await membershipIds(device);
  return {
    personalId,
    initialServerIds,
    first,
    firstResult,
    beforeLoss,
    afterLoss,
    afterCommitServerIds,
    hydrated,
    beforeRetry,
    retry,
    afterRetryServerIds,
    afterRetry,
    afterRestart,
    afterRestartServerIds,
    submitted,
    statuses,
  };
}

export async function observeExactPlainReplay(world: World) {
  const user = await world.register("plain-replay");
  const device = user.devices[0];
  if (!device) throw new Error("Expected an original device");
  const initialServerIds = await membershipIds(device);
  const created = await device.sdk.session.createOrganization(options);
  if (!created) throw device.failure("plain create failed");
  const [request] = device.transport.history.filter(organizationCreate);
  if (!request) throw new Error("Expected the original create request");
  const response = await fetch(`${device.transport.origin}/organizations`, {
    method: "POST",
    headers: { ...headers(device), "Content-Type": "application/json" },
    body: JSON.stringify(request.body),
  });
  const body: unknown = await response.json();
  return {
    created,
    submitted: requestIdentity(request.body),
    status: response.status,
    body,
    initialServerIds,
    afterReplayServerIds: await membershipIds(device),
  };
}
