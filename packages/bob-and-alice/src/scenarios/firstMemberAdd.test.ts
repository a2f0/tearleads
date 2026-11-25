import { afterEach, expect, test } from "bun:test";
import {
  deriveStableDocumentId,
  getOrganizationProfileDocumentLocalId,
} from "@tearleads/client-sdk";
import type { Device } from "../harness/device";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

/** What `device` asked about documents since `from`: creates or the profile. */
function documentRequests(device: Device, from: number, profileId: string) {
  return device.transport.history
    .slice(from)
    .filter(
      (request) =>
        (request.method === "POST" && request.path.endsWith("/documents")) ||
        request.path.includes(`/documents/${profileId}`),
    )
    .map(({ method, path, status, errorCode }) => ({
      method,
      path,
      status,
      errorCode,
    }));
}

// Registration creates the organization profile document. A member add used
// to push that profile afterwards by opening it under its creation-local id,
// so an install that had not registered the organization (a fresh login, or
// the CLI's in-memory database) birthed an empty local copy whose first sync
// re-submitted the profile's create: the API refused it with 409
// `document_manifest_already_exists` and the SDK adopted it, at the cost of a
// failed request and a writer-projection read (#3257). A member add only
// commits group policy; it neither creates nor reads the profile.
test("a member add neither re-creates nor reads the organization profile", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  const registered = alice.devices[0];
  if (!registered) throw new Error("alice has no device");
  const profileId = await deriveStableDocumentId(
    getOrganizationProfileDocumentLocalId({
      organizationId: registered.organizationId,
    }),
  );

  // The organization's first member, added from a fresh install that has
  // pulled its folders, as an opened app has, so it reaches the profile's
  // Organization Metadata container.
  const fresh = await world.newDevice(alice);
  await fresh.holdFolder(world.root(alice).id);
  const freshFrom = fresh.transport.history.length;
  await world.addToOrganization(alice, bob, fresh);
  expect(documentRequests(fresh, freshFrom, profileId)).toEqual([]);

  // A later member, added from the install that registered, its tree open.
  await registered.holdFolder(world.root(alice).id);
  const registeredFrom = registered.transport.history.length;
  await world.addToOrganization(alice, carol, registered);
  expect(documentRequests(registered, registeredFrom, profileId)).toEqual([]);

  expect(fresh.errors).toEqual([]);
  expect(registered.errors).toEqual([]);
  expectNoSecurityIncidents(world);
}, 120_000);
