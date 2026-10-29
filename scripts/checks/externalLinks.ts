import type { ExternalLink } from "./docLinks";

/**
 * Probes external documentation URLs. Only answers that prove a link is dead
 * (404, 410, or an unresolvable host) fail; authorization walls, rate limits,
 * and server errors are reported as unverified, since bots see them for pages
 * a reader can open. Some bot walls answer 404 (ftc.gov does), so a 404 counts
 * only when the host's home page answers successfully.
 */

export interface ExternalLinkResult {
  readonly url: string;
  readonly status: "ok" | "broken" | "unverified";
  readonly detail: string;
  readonly sources: readonly ExternalLink[];
}

// Hosts that name no real page: examples, local servers, and documentation
// placeholders.
const skippedHosts =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|([\w-]+\.)*example\.(com|org|net)|([\w-]+\.)*localhost)$/i;

export async function probeExternalLinks(
  links: readonly ExternalLink[],
  options: {
    readonly concurrency?: number;
    readonly timeoutMs?: number;
    /** Hosts not to probe; defaults to example and local hosts. */
    readonly skipHosts?: RegExp;
  } = {},
): Promise<ExternalLinkResult[]> {
  const byUrl = new Map<string, ExternalLink[]>();
  for (const link of links) {
    const url = link.url.replace(/#.*$/, "");
    if (!isProbeable(url, options.skipHosts ?? skippedHosts)) continue;
    byUrl.set(url, [...(byUrl.get(url) ?? []), link]);
  }
  const queue = [...byUrl.keys()].sort();
  const results: ExternalLinkResult[] = [];
  const timeoutMs = options.timeoutMs ?? 15_000;
  const homePages = new Map<string, Promise<boolean>>();
  const homePageAnswers = (url: string) => {
    const origin = new URL(url).origin;
    let answer = homePages.get(origin);
    if (answer === undefined) {
      answer = probe(`${origin}/`, timeoutMs).then(
        (outcome) => outcome.status === "ok",
      );
      homePages.set(origin, answer);
    }
    return answer;
  };
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      let outcome = await probe(url, timeoutMs);
      if (
        outcome.status === "broken" &&
        outcome.detail.startsWith("HTTP") &&
        !(await homePageAnswers(url))
      ) {
        outcome = {
          status: "unverified",
          detail: `${outcome.detail}, and the host's home page fails too (likely a bot wall)`,
        };
      }
      results.push({ url, ...outcome, sources: byUrl.get(url) ?? [] });
    }
  };
  await Promise.all(
    Array.from({ length: options.concurrency ?? 8 }, () => worker()),
  );
  return results.sort((left, right) => (left.url < right.url ? -1 : 1));
}

function isProbeable(url: string, skipHosts: RegExp): boolean {
  try {
    const { hostname } = new URL(url);
    return !skipHosts.test(hostname) && !/[<>{}$]/.test(url);
  } catch {
    return false;
  }
}

async function probe(
  url: string,
  timeoutMs: number,
): Promise<Pick<ExternalLinkResult, "status" | "detail">> {
  let response: Response | null = null;
  for (const method of ["HEAD", "GET"]) {
    try {
      response = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "tearleads-doc-link-check" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        /ENOTFOUND|getaddrinfo|Unable to connect|ConnectionRefused/i.test(
          message,
        )
      ) {
        return { status: "broken", detail: message };
      }
      if (method === "GET") return { status: "unverified", detail: message };
      continue;
    }
    // Some servers reject or mishandle HEAD; retry those with GET.
    if (response.ok || method === "GET") break;
  }
  if (response === null) return { status: "unverified", detail: "no response" };
  await response.body?.cancel();
  if (response.ok) return { status: "ok", detail: String(response.status) };
  if (response.status === 404 || response.status === 410) {
    return { status: "broken", detail: `HTTP ${response.status}` };
  }
  return { status: "unverified", detail: `HTTP ${response.status}` };
}
