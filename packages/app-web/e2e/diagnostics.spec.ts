import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

test("real browser error envelopes exclude private data and automatic activity", async ({
  page,
  context,
}) => {
  const output = await mkdtemp(join(tmpdir(), "tearleads-sentry-browser-"));
  const fixture = fileURLToPath(
    new URL("./fixtures/diagnostics.ts", import.meta.url),
  );
  const requests: Array<{ headers: Record<string, string>; body: string }> = [];
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/api/")) {
      response.writeHead(200);
      response.end("{}");
      return;
    }
    if (request.url === `/${bundle}`) {
      void readFile(join(output, request.url.slice(1))).then((bytes) => {
        response.writeHead(200, { "Content-Type": "text/javascript" });
        response.end(bytes);
      });
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<script type="module" src="/${bundle}"></script>`);
  });
  let bundle = "";
  try {
    bundle = await buildDiagnosticFixture(fixture, output);
    expect(bundle).not.toBe("");
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test server address");
    await context.addCookies([
      {
        name: "sentry-private-cookie",
        value: "SYNTHETIC_PRIVATE_DOCUMENT_KEY",
        domain: "o1.ingest.us.sentry.io",
        path: "/",
        secure: true,
      },
    ]);
    await page.route("https://*.sentry.io/**", async (route) => {
      if (route.request().method() === "POST") {
        requests.push({
          headers: await route.request().allHeaders(),
          body: route.request().postData() ?? "",
        });
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    });
    await page.goto(
      `http://127.0.0.1:${address.port}/SYNTHETIC_PRIVATE_DOCUMENT_KEY?token=SYNTHETIC_PRIVATE_DOCUMENT_KEY`,
    );
    await page
      .getByRole("button", { name: "SYNTHETIC_PRIVATE_DOCUMENT_KEY" })
      .click();
    await expect.poll(() => requests.length).toBe(1);
    await page.getByRole("button", { name: "Reject promise" }).click();
    await expect.poll(() => requests.length).toBe(2);
    await page.getByRole("button", { name: "Reject private string" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "stringRejectionObserved")),
      )
      .toBe(true);
    await page.evaluate(() => Reflect.get(window, "disposeDiagnostics")());
    expect(requests).toHaveLength(2);
    for (const request of requests) expectPrivateEnvelope(request);
    const last = JSON.parse(
      requests.at(-1)?.body.trim().split("\n")[2] ?? "{}",
    );
    expect(
      last.breadcrumbs.map((crumb: { data: unknown }) => crumb.data),
    ).toEqual([
      { area: "explorer", action: "move-to-trash" },
      { area: "explorer", action: "root-view" },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(output, { recursive: true, force: true });
  }
});

function expectPrivateEnvelope(request: {
  headers: Record<string, string>;
  body: string;
}) {
  const { referer, cookie } = request.headers;
  expect(referer).toBeUndefined();
  expect(cookie).toBeUndefined();
  expect(request.body).not.toContain("SYNTHETIC_PRIVATE_DOCUMENT_KEY");
  const [header, item, payload] = request.body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(Object.keys(header).sort()).toEqual(["event_id", "sent_at"]);
  expect(item.type).toBe("event");
  expect(payload.environment).toBe("staging");
  expect(payload.release).toBe(`tearleads-web@${"b".repeat(40)}`);
  expect(payload.contexts).toBeUndefined();
  expect(payload.request).toBeUndefined();
  expect(payload.exception.values[0].value).toBe(
    "Application error (message omitted)",
  );
  expect(payload.exception.values[0].stacktrace.frames.length).toBeGreaterThan(
    0,
  );
  expect(
    payload.breadcrumbs.map((crumb: { category: string }) => crumb.category),
  ).toEqual(payload.breadcrumbs.map(() => "app.activity"));
}

async function buildDiagnosticFixture(
  fixture: string,
  output: string,
): Promise<string> {
  await promisify(execFile)("bun", [
    "build",
    fixture,
    "--outdir",
    output,
    "--entry-naming",
    "chunk-[hash].js",
    "--minify",
    "--target",
    "browser",
  ]);
  const bundle =
    (await readdir(output)).find((file) => file.endsWith(".js")) ?? "";

  return bundle;
}
