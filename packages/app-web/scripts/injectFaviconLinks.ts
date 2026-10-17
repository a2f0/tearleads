// Adds the favicon <link> tags to the built dist/index.html. They cannot live in
// src/index.html: Bun's HTML bundler resolves root-absolute asset paths such as
// /favicon.svg at build time and fails, because the images are rendered into
// dist/ afterwards by the agent-tool `app-web` image target.
const FAVICON_LINKS =
  '<link rel="icon" href="/favicon.ico" sizes="any" />' +
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />' +
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />';

export function injectFaviconLinks(html: string): string {
  if (html.includes("/favicon.svg")) return html;
  const out = html.replace(/<\/head>/i, `${FAVICON_LINKS}</head>`);
  if (out === html) throw new Error("No </head> found in index.html");
  return out;
}

if (import.meta.main) {
  const indexHtml = Bun.file(new URL("../dist/index.html", import.meta.url));
  if (!(await indexHtml.exists())) {
    throw new Error("dist/index.html not found; run the bundle build first.");
  }
  await Bun.write(indexHtml, injectFaviconLinks(await indexHtml.text()));
  console.log("Injected favicon links into dist/index.html");
}
