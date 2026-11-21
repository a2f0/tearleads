import { expect, test } from "bun:test";
import { runSeedCommandWithDeadline } from "./seedCommandLifetime";

test("a stalled verification revokes its session before returning a timeout", async () => {
  let revoked = false;
  const messages: string[] = [];
  const result = await runSeedCommandWithDeadline(
    async (register) => {
      register(async () => {
        await Bun.sleep(5);
        revoked = true;
        return true;
      });
      return new Promise<number>(() => {});
    },
    (message) => messages.push(message),
    5,
  );
  expect(result).toBe(1);
  expect(revoked).toBe(true);
  expect(messages).toEqual(["Seed command timed out."]);
});

test("a stalled logout returns after the revocation grace period", async () => {
  const messages: string[] = [];
  const result = await runSeedCommandWithDeadline(
    async (register) => {
      register(() => new Promise<boolean>(() => {}));
      return new Promise<number>(() => {});
    },
    (message) => messages.push(message),
    5,
    5,
  );
  expect(result).toBe(1);
  expect(messages.at(-1)).toContain("Could not confirm revocation");
});

test("interrupting a signed-in command awaits revocation", async () => {
  let revoked = false;
  const messages: string[] = [];
  const result = await runSeedCommandWithDeadline(
    async (register) => {
      register(async () => {
        await Bun.sleep(1);
        revoked = true;
        return true;
      });
      process.emit("SIGINT");
      return new Promise<number>(() => {});
    },
    (line) => messages.push(line),
  );
  expect(result).toBe(1);
  expect(revoked).toBe(true);
  expect(messages).toEqual(["Seed command interrupted."]);
});

test("a sign-in accepted during shutdown gets a fresh logout grace period", async () => {
  const messages: string[] = [];
  let revoked = false;
  const result = await runSeedCommandWithDeadline(
    async (register) => {
      const logout = Promise.withResolvers<void>();
      register(async () => {
        await Bun.sleep(70);
        logout.resolve();
        await Bun.sleep(70);
        revoked = true;
        return true;
      }, logout.promise);
      process.emit("SIGINT");
      return new Promise<number>(() => {});
    },
    (message) => messages.push(message),
    1000,
    100,
  );
  expect(result).toBe(1);
  expect(revoked).toBe(true);
  expect(messages).toEqual(["Seed command interrupted."]);
});
