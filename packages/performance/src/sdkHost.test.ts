import { expect, test } from "bun:test";
import { provisioningSpec } from "./provisioningSpec";

function requiredMatch(source: string, pattern: RegExp): string {
  const match = source.match(pattern)?.[1];
  if (match === undefined)
    throw new Error("App Trash definition moved; recheck the scenario.");
  return match;
}

test("the scenario's Trash specification matches the app's public host input", async () => {
  const source = await Bun.file(
    new URL("../../app/src/stores/systemContainers.ts", import.meta.url),
  ).text();
  const definition = source.match(
    /EXPLORER_TRASH_CONTAINER_SYSTEM_SLOT_DEFINITION:[\s\S]*?=\s*\{([^}]+)\}/,
  )?.[1];
  if (!definition)
    throw new Error(
      "App Trash slot definition moved; recheck the provisioning scenario.",
    );
  const field = (name: string) =>
    requiredMatch(definition, new RegExp(`${name}:\\s*"([^"]+)"`));
  expect(provisioningSpec).toEqual([
    {
      name: requiredMatch(
        source,
        /EXPLORER_TRASH_CONTAINER_NAME\s*=\s*"([^"]+)"/,
      ),
      icon: requiredMatch(
        source,
        /EXPLORER_TRASH_CONTAINER_ICON\s*=\s*"([^"]+)"/,
      ),
      slotDefinition: {
        namespace: field("namespace"),
        projectorId: field("projectorId"),
        slotId: field("slotId"),
        version: Number(definition.match(/version:\s*(\d+)/)?.[1]),
      },
    },
  ]);
});
