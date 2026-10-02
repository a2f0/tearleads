import { expect, test } from "bun:test";
import {
  createAdoptionScenario,
  runListedCreateAdoption,
} from "../../../../test/helpers/containerCreateAdoption";

// A pending create whose container a listing already carries is adopted only
// when the signed epoch-1 create is this user's, in the intended organization
// (#2365 finding 26). Settlement learns where the create committed and where
// the verified head sits now.

test("a listed container this user created is adopted", async () => {
  const { listedChild, parent } = await createAdoptionScenario();
  const child = await listedChild();
  const parentId = parent.projection.containerId;

  const result = await runListedCreateAdoption({
    intents: [{ containerId: child.containerId }],
    parent,
    served: [child],
  });

  expect(result.created).toBe(1);
  expect(result.recordedErrors).toEqual([]);
  expect(result.evicted).toEqual([]);
  expect(result.settlements).toEqual([
    {
      containerId: child.containerId,
      createdParent: parentId,
      currentParent: parentId,
      desiredParent: parentId,
    },
  ]);
});

test("a container moved while its create was pending is adopted with the move owed", async () => {
  const { listedChild, parent } = await createAdoptionScenario();
  const child = await listedChild();
  const parentId = parent.projection.containerId;
  const movedLocallyTo = crypto.randomUUID();

  const result = await runListedCreateAdoption({
    intents: [
      { containerId: child.containerId, desiredParentId: movedLocallyTo },
    ],
    parent,
    served: [child],
  });

  // The create committed under the original parent; settlement queues the
  // move to where the user put it instead of reporting tampering.
  expect(result.created).toBe(1);
  expect(result.incidents).toEqual([]);
  expect(result.settlements).toEqual([
    {
      containerId: child.containerId,
      createdParent: parentId,
      currentParent: parentId,
      desiredParent: movedLocallyTo,
    },
  ]);
});

test("a container another writer moved settles from its verified head", async () => {
  const { listedChild, movedChild, parent } = await createAdoptionScenario();
  const destination = await listedChild();
  const child = await movedChild(await listedChild(), destination);
  const parentId = parent.projection.containerId;

  const result = await runListedCreateAdoption({
    intents: [{ containerId: child.containerId }],
    parent,
    served: [child],
  });

  // An owed move must cite where the folder is now, not where it was
  // created, and the unchanged intent lets the remote move stand.
  expect(result.created).toBe(1);
  expect(result.incidents).toEqual([]);
  expect(result.settlements).toEqual([
    {
      containerId: child.containerId,
      createdParent: parentId,
      currentParent: destination.containerId,
      desiredParent: parentId,
    },
  ]);
});

test("a projection served for another identity is refused before it is verified", async () => {
  const { listedChild, parent } = await createAdoptionScenario();
  const child = await listedChild();

  const result = await runListedCreateAdoption({
    intents: [{ containerId: child.containerId }],
    parent,
    served: [{ ...child, organizationId: crypto.randomUUID() }],
  });

  expect(result.created).toBe(0);
  expect(result.incidents).toEqual(["container.create.replay"]);
  expect(result.recordedErrors).toEqual([
    "Container create adoption was refused: Container create conflict projection has the wrong identity",
  ]);
  // A refused projection is never served from the cache again.
  expect(result.evicted).toEqual([child.containerId]);
});

test("a listed container in another organization is refused as such", async () => {
  const { listedChild, parent } = await createAdoptionScenario();
  const child = await listedChild();

  const result = await runListedCreateAdoption({
    intents: [{ containerId: child.containerId, organization: "other" }],
    parent,
    // The unsigned envelope repeats the local organization; the signed create
    // still names its own.
    served: [{ ...child, organizationId: "another-organization" }],
  });

  expect(result.created).toBe(0);
  expect(result.incidents).toEqual(["container.create.replay"]);
  expect(result.recordedErrors).toEqual([
    "Container create adoption was refused: Container create conflict belongs to another organization",
  ]);
});

test("a listed root is refused as a root, not as another organization", async () => {
  const { parent } = await createAdoptionScenario();
  const root = parent.projection;

  const result = await runListedCreateAdoption({
    intents: [
      { containerId: root.containerId, desiredParentId: crypto.randomUUID() },
    ],
    parent,
    served: [root],
  });

  expect(result.created).toBe(0);
  expect(result.incidents).toEqual(["container.create.replay"]);
  expect(result.recordedErrors).toEqual([
    "Container create adoption was refused: Container create conflict is an organization root",
  ]);
});
