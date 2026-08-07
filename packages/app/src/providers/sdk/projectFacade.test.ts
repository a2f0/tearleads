import { expect, test } from "bun:test";
import { projectBoundFacade, projectFacade } from "./projectFacade";

test("plain facade projection keeps only public keys and function identities", () => {
  const publicAction = () => "public";
  const facade = { internalAction: () => "internal", publicAction };
  const projected = projectFacade(facade, ["publicAction"]);

  expect(Object.keys(projected)).toEqual(["publicAction"]);
  expect(projected.publicAction).toBe(publicAction);
  expect("internalAction" in projected).toBe(false);
});

test("bound facade projection stays callable after object spread", () => {
  class ExampleFacade {
    constructor(private readonly prefix: string) {}

    format(value: string): string {
      return `${this.prefix}:${value}`;
    }
  }

  const projected = projectBoundFacade(new ExampleFacade("sdk"), ["format"]);
  const spread = { ...projected };

  expect(Object.keys(projected)).toEqual(["format"]);
  expect(spread.format("value")).toBe("sdk:value");
  expect(spread.format).toBe(projected.format);
});
