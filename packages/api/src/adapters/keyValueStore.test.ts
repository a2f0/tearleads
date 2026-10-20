import { expect, test } from "bun:test";
import { collectWorkerSetMembers } from "./keyValueStore";

/**
 * A key/value store whose caller prunes members while paging, as
 * `listUserSessions` does with expired sessions: the second page must not
 * skip live members just because earlier ones disappeared.
 */
function pruningStore(members: string[], pageSize: number) {
  const pages: string[][] = [];
  return {
    pages,
    store: {
      smembers: async (_key: string, after: string | null) => {
        const page = members
          .filter((member) => after === null || member > after)
          .slice(0, pageSize);
        pages.push([...page]);
        // Simulate the caller removing the first member it saw before asking
        // for the next page.
        if (page[0] !== undefined) {
          members.splice(members.indexOf(page[0]), 1);
        }
        return page;
      },
    },
  };
}

test("set paging survives members removed between pages", async () => {
  const { store } = pruningStore(["a", "b", "c", "d", "e"], 2);
  const collected: string[] = [];
  for await (const page of collectWorkerSetMembers(store, "k", 2)) {
    collected.push(...page);
  }
  expect(collected).toEqual(["a", "b", "c", "d", "e"]);
});

test("set paging stops after a short page", async () => {
  const { pages, store } = pruningStore(["a", "b", "c"], 2);
  const collected: string[] = [];
  for await (const page of collectWorkerSetMembers(store, "k", 2)) {
    collected.push(...page);
  }
  expect(collected).toEqual(["a", "b", "c"]);
  expect(pages).toHaveLength(2);
});
