/**
 * Repository documents the website publishes under /docs/. The Markdown in the
 * repository stays the source of truth: the `docs` content collection loads
 * these files at build time, and `docLinksPlugin` rewrites their relative
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
  /** Slug of the document a topic page belongs to; absent for documents. */
  readonly parent?: string;
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

/**
 * Topic pages of the longer documents. Each document's own page is a short
 * index that links its topic pages, which publish under /docs/<slug>/<topic>/.
 */
export const technicalDocPages: readonly TechnicalDoc[] = [
  {
    slug: "keying-design/overview",
    source: "docs/keying-design/overview.md",
    title: "Keying design: overview",
    summary:
      "Design properties, boundaries, threat model, and principal policy.",
    parent: "keying-design",
  },
  {
    slug: "keying-design/access-manifests",
    source: "docs/keying-design/access-manifests.md",
    title: "Keying design: access manifests",
    summary: "Signed access events and manifests, and the authorization rules.",
    parent: "keying-design",
  },
  {
    slug: "keying-design/container-keks",
    source: "docs/keying-design/container-keks.md",
    title: "Keying design: container KEKs",
    summary:
      "The container KEK hierarchy and additive versus subtractive changes.",
    parent: "keying-design",
  },
  {
    slug: "keying-design/content-keys",
    source: "docs/keying-design/content-keys.md",
    title: "Keying design: content keys",
    summary:
      "Document and blob content keys, wrapping suites, and create intents.",
    parent: "keying-design",
  },
  {
    slug: "keying-design/verification",
    source: "docs/keying-design/verification.md",
    title: "Keying design: verification",
    summary:
      "Transparency, checkpoints, client verification, and attack outcomes.",
    parent: "keying-design",
  },
  {
    slug: "keying-design/storage-and-scaling",
    source: "docs/keying-design/storage-and-scaling.md",
    title: "Keying design: storage and scaling",
    summary: "Storage state, scaling model, protocol surface, and invariants.",
    parent: "keying-design",
  },
  {
    slug: "security-guarantees/overview",
    source: "docs/security-guarantees/overview.md",
    title: "Security guarantees: overview",
    summary: "The short answer, threat model, destinations, and handshake.",
    parent: "security-guarantees",
  },
  {
    slug: "security-guarantees/properties",
    source: "docs/security-guarantees/properties.md",
    title: "Security guarantees: security properties",
    summary:
      "Each security property the protocol enforces and what it protects.",
    parent: "security-guarantees",
  },
  {
    slug: "security-guarantees/boundaries",
    source: "docs/security-guarantees/boundaries.md",
    title: "Security guarantees: boundaries",
    summary: "Known gaps, disclosure scenarios, and the invariant summary.",
    parent: "security-guarantees",
  },
  {
    slug: "protocol-specification/foundations",
    source: "docs/protocol-specification/foundations.md",
    title: "Protocol specification: foundations",
    summary: "Goals, protocol planes, and the common cryptographic objects.",
    parent: "protocol-specification",
  },
  {
    slug: "protocol-specification/identity-and-policy",
    source: "docs/protocol-specification/identity-and-policy.md",
    title: "Protocol specification: identity and policy",
    summary:
      "The identity and session handshake and the principal policy protocol.",
    parent: "protocol-specification",
  },
  {
    slug: "protocol-specification/container-access",
    source: "docs/protocol-specification/container-access.md",
    title: "Protocol specification: container access",
    summary: "Container access, KEK delivery, and document link and sync.",
    parent: "protocol-specification",
  },
  {
    slug: "protocol-specification/blobs",
    source: "docs/protocol-specification/blobs.md",
    title: "Protocol specification: blobs and attachments",
    summary: "Blob staging, attachment bind and slots, and blob reads.",
    parent: "protocol-specification",
  },
  {
    slug: "protocol-specification/delete-and-failure",
    source: "docs/protocol-specification/delete-and-failure.md",
    title: "Protocol specification: delete and failure",
    summary: "Delete and purge semantics and failure semantics.",
    parent: "protocol-specification",
  },
  {
    slug: "glossary/access",
    source: "docs/glossary/access.md",
    title: "Glossary: access and authorization",
    summary:
      "Terms for containers, grants, access manifests, and how access is derived.",
    parent: "glossary",
  },
  {
    slug: "glossary/keys",
    source: "docs/glossary/keys.md",
    title: "Glossary: keys and rotation",
    summary:
      "Terms for content keys, container KEKs, key targets, and key rotation.",
    parent: "glossary",
  },
  {
    slug: "glossary/content",
    source: "docs/glossary/content.md",
    title: "Glossary: documents and attachments",
    summary: "Terms for documents, Loro updates, blobs, and attachment slots.",
    parent: "glossary",
  },
  {
    slug: "glossary/principals",
    source: "docs/glossary/principals.md",
    title: "Glossary: identity and organizations",
    summary:
      "Terms for users, identity links and pins, organizations, and principals.",
    parent: "glossary",
  },
  {
    slug: "glossary/sync",
    source: "docs/glossary/sync.md",
    title: "Glossary: sync and server state",
    summary:
      "Terms for checkpoints, heads, projections, and client sync scheduling.",
    parent: "glossary",
  },
];

/** Every published Markdown page: the documents and their topic pages. */
export const publishedDocs: readonly TechnicalDoc[] = [
  ...technicalDocs,
  ...technicalDocPages,
];

/**
 * The API reference is rendered from docs/openapi.json rather than Markdown
 * (src/apiReference/), so it is listed beside the documents, not among them.
 */
export const apiReferenceListing = {
  path: "/docs/api/",
  source: "docs/openapi.json",
  title: "API reference",
  summary:
    "Every HTTP operation, the fields it accepts and returns, and the rules the server enforces.",
} as const;

const repositoryUrl = "https://github.com/a2f0/tearleads";
/** Links from published documents point at the branch the site deploys from. */
const repositoryRef = "main";

export function docPath(doc: TechnicalDoc): string {
  return `/docs/${doc.slug}/`;
}

export function sourceUrl(path: string, directory = false): string {
  return `${repositoryUrl}/${directory ? "tree" : "blob"}/${repositoryRef}/${path}`;
}

const bySource = new Map(publishedDocs.map((doc) => [doc.source, doc]));

export function docForSource(source: string): TechnicalDoc | undefined {
  return bySource.get(source);
}

export function docForSlug(slug: string): TechnicalDoc {
  const doc = publishedDocs.find((candidate) => candidate.slug === slug);
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
  // Published pages have no line anchors; keep #L<n> links on GitHub.
  if (doc !== undefined && !/^#L\d/.test(fragment)) {
    return `${docPath(doc)}${fragment}`;
  }
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
