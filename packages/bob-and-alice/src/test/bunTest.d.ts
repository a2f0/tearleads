declare module 'bun:test' {
  export function beforeEach(
    fn: () => void | Promise<void>
  ): void | Promise<void>;
  export function afterEach(
    fn: () => void | Promise<void>
  ): void | Promise<void>;
  export function describe(
    name: string,
    fn: () => void | Promise<void>
  ): void | Promise<void>;
  export function it(
    name: string,
    fn: () => void | Promise<void>
  ): void | Promise<void>;

  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
  };
}
