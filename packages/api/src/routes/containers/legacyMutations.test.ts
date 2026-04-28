import { expect, test } from "bun:test";
import { routeApp } from "../../routeApp";

test("legacy container mutation routes are not mounted", async () => {
  const routes = [
    { body: { id: crypto.randomUUID() }, path: "/containers" },
    {
      body: { subjectType: "user", subjectId: crypto.randomUUID() },
      path: `/containers/${crypto.randomUUID()}/share`,
    },
    {
      body: { parentId: crypto.randomUUID() },
      path: `/containers/${crypto.randomUUID()}/move`,
    },
  ];

  for (const route of routes) {
    const response = await routeApp.request(route.path, {
      body: JSON.stringify(route.body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(404);
  }
});
