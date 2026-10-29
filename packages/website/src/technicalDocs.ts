/**
 * Repository documents the website publishes under /docs/. The Markdown in the
 * repository stays the source of truth: the `docs` content collection loads
 * these files at build time, and `rehypeDocLinks` rewrites their relative
 * links (to another published document, or to GitHub for everything else).
 */

export interface TechnicalDoc {
  /** Site path segment: /docs/<slug>/. */
  readonly slug: string;
  /** Repository-relative path of the Markdown source. */
  readonly source: string;
  /** Short title for lists; the page title is the document's own h1. */
  readonly title: string;
  readonly summary: string;
}

export const technicalDocs: readonly TechnicalDoc[] = [
  {
    slug: "security-guarantees",
    source: "docs/security-guarantees.md",
    title: "Security guarantees",
    summary:
      "What each property protects, the threat model, and the known gaps.",
  },
  {
    slug: "keying-design",
    source: "docs/keying-design.md",
    title: "Keying design",
    summary: "How content keys, container keys, and recipients fit together.",
  },
  {
    slug: "protocol-specification",
    source: "docs/protocol-specification.md",
    title: "Protocol specification",
    summary: "Messages, proofs, validation rules, and failure semantics.",
  },
  {
    slug: "cipher-suites",
    source: "docs/cipher-suites.md",
    title: "Cipher suites",
    summary: "The cryptographic primitives and where each one is used.",
  },
  {
    slug: "protocol-models",
    source: "formal/README.md",
    title: "Protocol models (TLA+)",
    summary:
      "Bounded models of protocol safety rules that complement, not replace, tests.",
  },
  {
    slug: "limits",
    source: "docs/limits.md",
    title: "Limits",
    summary:
      "Every bound the protocol enforces, what enforces it, and what happens past it.",
  },
  {
    slug: "glossary",
    source: "docs/glossary.md",
    title: "Glossary",
    summary: "Shared protocol terms used across the technical documents.",
  },
];

const repositoryUrl = "https://github.com/a2f0/tearleads";
/** Links from published documents point at the branch the site deploys from. */
const repositoryRef = "main";

export function docPath(doc: TechnicalDoc): string {
  return `/docs/${doc.slug}/`;
}

export function sourceUrl(path: string, directory = false): string {
  return `${repositoryUrl}/${directory ? "tree" : "blob"}/${repositoryRef}/${path}`;
}

const bySource = new Map(technicalDocs.map((doc) => [doc.source, doc]));

export function docForSource(source: string): TechnicalDoc | undefined {
  return bySource.get(source);
}

export function docForSlug(slug: string): TechnicalDoc {
  const doc = technicalDocs.find((candidate) => candidate.slug === slug);
  if (doc === undefined) throw new Error(`No technical document ${slug}`);
  return doc;
}

/**
 * Where a link in a published document should point on the website. `href`
 * is the link as written in `fromSource` (a repository-relative path).
 * Relative links reach another published document's page, or else the file
 * on GitHub; absolute URLs and same-page fragments are kept.
 */
export function resolveDocHref(href: string, fromSource: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return href;
  if (href.startsWith("#") || href === "") return href;
  const hashIndex = href.indexOf("#");
  const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : href.slice(hashIndex);
  const directory = path.endsWith("/");
  const target = resolveRepositoryPath(fromSource, path);
  if (target === null) return href;
  const doc = docForSource(target);
  if (doc !== undefined) return `${docPath(doc)}${fragment}`;
  return `${sourceUrl(target, directory)}${fragment}`;
}

/** `path` resolved against `fromSource`'s directory; null outside the repo. */
function resolveRepositoryPath(
  fromSource: string,
  path: string,
): string | null {
  const segments = path.startsWith("/")
    ? []
    : fromSource.split("/").slice(0, -1);
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
}
