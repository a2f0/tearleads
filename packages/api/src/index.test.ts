import { expect, test } from "bun:test";
import { createRouteRequestBindings } from "./index";

test("createRouteRequestBindings exposes the Bun direct client IP", () => {
  const req = new Request("http://localhost:3001/auth/verify");

  const bindings = createRouteRequestBindings(req, {
    requestIP(request) {
      expect(request).toBe(req);
      return { address: "127.0.0.1" };
    },
  });

  expect(bindings).toEqual({ directClientIp: "127.0.0.1" });
});

test("createRouteRequestBindings omits direct client IP when unavailable", () => {
  const bindings = createRouteRequestBindings(
    new Request("http://localhost:3001/auth/verify"),
    {
      requestIP() {
        return null;
      },
    },
  );

  expect(bindings).toEqual({});
});

test("createRouteRequestBindings omits direct client IP when Bun cannot resolve it", () => {
  const bindings = createRouteRequestBindings(
    new Request("http://localhost:3001/auth/verify"),
    {
      requestIP() {
        throw new Error("request is not attached to a socket");
      },
    },
  );

  expect(bindings).toEqual({});
});
