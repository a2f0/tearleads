import { expect, test } from "bun:test";
import { extendBoundFacade } from "./OrgManagerProvider";

class ExampleFacade {
  constructor(private readonly prefix: string) {}

  format(value: string): string {
    return `${this.prefix}:${value}`;
  }
}

test("extended facades keep SDK methods bound and stable", () => {
  const facade = new ExampleFacade("sdk");
  const extended = extendBoundFacade(facade, { ready: true });

  const format = extended.format;

  expect(format("value")).toBe("sdk:value");
  expect(extended.format).toBe(format);
  expect("format" in extended).toBe(true);
  expect(extended.ready).toBe(true);
});
