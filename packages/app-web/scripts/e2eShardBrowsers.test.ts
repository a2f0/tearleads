import { expect, test } from "bun:test";
import { listedProjects, shardBrowsers } from "./e2eShardBrowsers";

test("collects the project of every listed test, however deeply nested", () => {
  const projects = listedProjects([
    {
      specs: [{ tests: [{ projectName: "chromium" }] }],
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  tests: [
                    { projectName: "firefox" },
                    { projectName: "chromium" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
  expect([...projects].toSorted()).toEqual(["chromium", "firefox"]);
});

test("maps the shard's projects to their browsers in config order", () => {
  expect(shardBrowsers(new Set(["webkit", "chromium"]))).toEqual([
    "chromium",
    "webkit",
  ]);
  expect(shardBrowsers(new Set(["chromium"]))).toEqual(["chromium"]);
  expect(shardBrowsers(new Set())).toEqual([]);
});
