import { expect, test } from "bun:test";
import { workersFetch } from "../../test/helpers/workersFetch";
import { stripeRequest } from "./stripeHttp";

test("stripeRequest calls fetch without a receiver, as Workers require", async () => {
  const body = await stripeRequest({
    fetchImpl: workersFetch(async () => Response.json({ id: "price_1" })),
    secretKey: "sk_test",
    method: "GET",
    path: "/v1/prices/price_1",
    operation: "price lookup",
  });

  expect(body).toEqual({ id: "price_1" });
});
