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
