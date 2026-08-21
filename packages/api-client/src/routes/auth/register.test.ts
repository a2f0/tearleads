import { expect, test } from "bun:test";
import { registerOperation } from "@symcrypt/validators/operation";
import { register } from "./register";

test("registration client metadata derives from the shared operation", () => {
  expect(register).toMatchObject({
    method: registerOperation.method,
    path: "/auth/register",
  });
  expect(register.isRequest).toBeDefined();
  expect(register.isResponse).toBeDefined();
});
