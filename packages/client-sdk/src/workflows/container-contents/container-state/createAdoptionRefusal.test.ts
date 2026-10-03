import { expect, test } from "bun:test";
import {
  createAdoptionScenario,
  runListedCreateAdoption,
} from "../../../../test/helpers/containerCreateAdoption";
import { tamperFirstProjectionEventSignature } from "../../../../test/helpers/containerFixtures";
import { CONTAINER_CREATE_ADOPTION_REFUSED } from "./createAdoption";

// A failed adoption is recorded on its own intent and never stops the lane's
// pass: the rest of that sync iteration still runs. A create whose signed
// identity is foreign parks for good, since those facts never change.

test("a foreign create parks its intent without stopping its siblings", async () => {
  const { listedChild, parent } = await createAdoptionScenario();
  const foreign = await listedChild();
  const sibling = await listedChild();

  const result = await runListedCreateAdoption({
    intents: [
      {
        containerId: foreign.containerId,
        desiredParentId: crypto.randomUUID(),
        organization: "other",
      },
      { containerId: sibling.containerId },
    ],
    parent,
    // The envelope repeats the local organization; the signed create names
    // its own.
    served: [{ ...foreign, organizationId: "another-organization" }, sibling],
  });

  expect(result.created).toBe(1);
  expect(result.settlements.map((settled) => settled.containerId)).toEqual([
    sibling.containerId,
  ]);
  expect(result.incidents).toEqual(["container.create.replay"]);
  expect(result.recordedErrors).toEqual([
    `${CONTAINER_CREATE_ADOPTION_REFUSED}: Container create conflict belongs to another organization`,
  ]);
});

test("a parked intent is neither read nor reported again", async () => {
  const { listedChild, parent } = await createAdoptionScenario();
  const foreign = await listedChild();

  const result = await runListedCreateAdoption({
    intents: [
      {
        containerId: foreign.containerId,
        lastError: `${CONTAINER_CREATE_ADOPTION_REFUSED}: Container create conflict was signed by another user`,
      },
    ],
    parent,
    served: [foreign],
  });

  expect(result.created).toBe(0);
  expect(result.reads).toEqual([]);
  expect(result.incidents).toEqual([]);
  expect(result.recordedErrors).toEqual([]);
});

test("a listed container another user created is parked as an incident", async () => {
  const { listedChild, parent } = await createAdoptionScenario();
  const child = await listedChild();

  const result = await runListedCreateAdoption({
    intents: [{ containerId: child.containerId }],
    parent,
    served: [child],
    sessionUser: "another",
  });

  expect(result.created).toBe(0);
  expect(result.incidents).toEqual(["container.create.replay"]);
  expect(result.recordedErrors).toEqual([
    `${CONTAINER_CREATE_ADOPTION_REFUSED}: Container create conflict was signed by another user`,
  ]);
  expect(result.settlements).toEqual([]);
});

test("a projection that fails verification is reported and retried, not parked", async () => {
  const { listedChild, parent } = await createAdoptionScenario();
  const child = await listedChild();

  const result = await runListedCreateAdoption({
    intents: [{ containerId: child.containerId }],
    parent,
    served: [tamperFirstProjectionEventSignature(child)],
  });

  // A cached projection can be corrupt without its create being foreign, so
  // the next pass reads a fresh copy.
  expect(result.created).toBe(0);
  expect(result.incidents).toEqual(["container.create.replay"]);
  expect(result.evicted).toEqual([child.containerId]);
  expect(result.recordedErrors).toHaveLength(1);
  expect(result.recordedErrors[0]).toStartWith(
    "Container create adoption verification failed: ",
  );
});

test("a missing session user fails without an incident or a read", async () => {
  const { listedChild, parent } = await createAdoptionScenario();
  const child = await listedChild();

  const result = await runListedCreateAdoption({
    intents: [{ containerId: child.containerId }],
    parent,
    served: [child],
    sessionUser: "none",
  });

  expect(result.created).toBe(0);
  expect(result.reads).toEqual([]);
  expect(result.incidents).toEqual([]);
  expect(result.recordedErrors).toEqual([
    "Container create adoption verification failed: Container create conflict needs a signed-in session user",
  ]);
});

test("an unavailable projection leaves the create unadopted without an incident", async () => {
  const { listedChild, parent } = await createAdoptionScenario();
  const child = await listedChild();

  const result = await runListedCreateAdoption({
    intents: [{ containerId: child.containerId }],
    parent,
    served: [],
  });

  expect(result.created).toBe(0);
  expect(result.incidents).toEqual([]);
  expect(result.settlements).toEqual([]);
  expect(result.recordedErrors).toEqual([
    "Container create adoption verification failed: Container create conflict is unavailable to verify",
  ]);
});

test("a blocked organization's listed create is not read", async () => {
  const { listedChild, parent } = await createAdoptionScenario();
  const child = await listedChild();

  const result = await runListedCreateAdoption({
    blocked: true,
    intents: [{ containerId: child.containerId }],
    parent,
    served: [child],
  });

  expect(result.created).toBe(0);
  expect(result.reads).toEqual([]);
  expect(result.recordedErrors).toEqual([]);
});

test.each([
  ["refused in this pass", undefined],
  [
    "parked earlier",
    `${CONTAINER_CREATE_ADOPTION_REFUSED}: Container create conflict was signed by another user`,
  ],
] as const)(
  "no folder is created under a parent whose create was %s",
  async (_when, parentLastError) => {
    const { listedChild, parent } = await createAdoptionScenario();
    const foreign = await listedChild();
    const child = crypto.randomUUID();

    const result = await runListedCreateAdoption({
      intents: [
        {
          containerId: foreign.containerId,
          ...(parentLastError ? { lastError: parentLastError } : {}),
        },
        {
          containerId: child,
          desiredParentId: foreign.containerId,
          unlisted: true,
        },
      ],
      parent,
      served: [foreign],
      sessionUser: "another",
    });

    expect(result.created).toBe(0);
    // Only the parent's own adoption may read; the child sends nothing.
    expect(result.reads).toEqual(parentLastError ? [] : [foreign.containerId]);
    expect(result.recordedErrors).toEqual(
      parentLastError
        ? []
        : [
            `${CONTAINER_CREATE_ADOPTION_REFUSED}: Container create conflict was signed by another user`,
          ],
    );
  },
);
