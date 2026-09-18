import { expect, test } from "bun:test";
import type { SentryPrivacyConfig } from "./privacy";
import { sanitizeSentryEvent } from "./privacy";

for (const serverSourceRoot of [
  "C:\\Users\\Private Name\\Tearleads\\Resources\\app",
  "C:/Users/Private Name/Tearleads/Resources/app",
]) {
  test(`Windows main frames keep only allowlisted bundle paths under ${serverSourceRoot}`, () => {
    const config: SentryPrivacyConfig = {
      environment: "staging",
      release: "fixture",
      dist: "staging-app-win-x64",
      origin: "",
      scriptPath: "",
      scriptPaths: new Set(["/bun/index.js"]),
      serverSourceRoot,
      runtime: "electrobun-main",
    };
    const event = sanitizeSentryEvent(
      {
        tags: { diagnostic_source: "unhandled-error" },
        exception: {
          values: [
            {
              stacktrace: {
                frames: [
                  {
                    filename:
                      "C:\\Users\\Private Name\\Tearleads\\Resources\\app\\bun\\index.js",
                    lineno: 12,
                  },
                  {
                    filename:
                      "C:/Users/Private Name/Tearleads/Resources/app/bun/index.js",
                    lineno: 13,
                  },
                  {
                    filename:
                      "C:\\Users\\Private Name\\Other\\Resources\\app\\bun\\index.js",
                    lineno: 14,
                  },
                  { filename: `${serverSourceRoot}2/bun/index.js`, lineno: 15 },
                  {
                    filename: `${serverSourceRoot}\\..\\app\\bun\\index.js`,
                    lineno: 16,
                  },
                  { filename: "app:///bun/index.js", lineno: 17 },
                  { filename: "bun/index.js", lineno: 18 },
                ],
              },
            },
          ],
        },
      },
      config,
    );
    expect(event?.exception?.values?.[0]?.stacktrace?.frames).toEqual([
      { filename: "app:///bun/index.js", lineno: 12, in_app: true },
      { filename: "app:///bun/index.js", lineno: 13, in_app: true },
    ]);
    expect(JSON.stringify(event)).not.toContain("Private Name");
  });
}
