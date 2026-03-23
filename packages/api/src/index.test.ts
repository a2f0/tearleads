import { describe, expect, test } from "bun:test";
import { app } from "./index";

describe("GET /", () => {
  test("returns ok", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "ok" });
  });
});
