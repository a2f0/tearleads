import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { parseArgs } from "node:util";
import { checkArguments } from "../lib/checkRoot";
import {
  codeReferenceIssues,
  isCodeReferenceDocument,
  linkCodeReferences,
} from "./docCodeReferences";
import {
  checkDocuments,
  type DocLinkIssue,
  documentsToCheck,
  listRepositoryFiles,
  repositoryFiles,
} from "./docLinks";
import { probeExternalLinks } from "./externalLinks";

/**
 * Checks documentation links. See docs/developer/static-analysis.md.
 *
 *   bun run lint:doc-links                 offline checks (check:fast)
 *   bun run lint:doc-links -- --fix        also link unlinked code references
 *   bun run lint:doc-links -- --external   also probe external URLs
 *   bun run lint:doc-links -- docs/x.md    limit to named documents
 */

const { root, args } = checkArguments();
const { values, positionals } = parseArgs({
  args,
  allowPositionals: true,
  options: {
    external: { type: "boolean", default: false },
    fix: { type: "boolean", default: false },
  },
});

const repo = repositoryFiles(root, listRepositoryFiles(root));
function repositoryPath(path: string): string {
  const local = relative(root, path);
  if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
    throw new Error(`Document is outside the checkout: ${path}`);
  return local.split(sep).join("/");
}

const documents = positionals.length
  ? positionals.map((path) => {
      const absolute = resolve(path);
      return repositoryPath(
        join(realpathSync(dirname(absolute)), basename(absolute)),
      );
    })
  : documentsToCheck(repo);
// Check the symlink target as well before reading or rewriting a document.
for (const document of documents) {
  const path = join(root, document);
  repositoryPath(
    realpathSync(lstatSync(path).isSymbolicLink() ? path : dirname(path)),
  );
}

if (values.fix) {
  for (const document of documents.filter(isCodeReferenceDocument)) {
    const path = join(root, document);
    const source = readFileSync(path, "utf8");
    const fixed = linkCodeReferences(repo, document, source);
    if (fixed !== source) {
      writeFileSync(path, fixed);
      console.log(`linked code references in ${document}`);
    }
  }
}

const { issues, external } = checkDocuments(repo, documents);
for (const document of documents.filter(isCodeReferenceDocument)) {
  const source = readFileSync(join(root, document), "utf8");
  issues.push(...codeReferenceIssues(repo, document, source));
}
report(issues);

if (values.external) {
  const results = await probeExternalLinks(external);
  let broken = 0;
  for (const result of results) {
    if (result.status === "ok") continue;
    if (result.status === "broken") broken += 1;
    const where = result.sources
      .map((source) => `${source.file}:${source.line}`)
      .join(", ");
    console.error(
      `${result.status === "broken" ? "error" : "warning"} doc-links: ${result.url} ${result.detail} (${where})`,
    );
  }
  console.log(
    `doc-links: probed ${results.length} external URLs, ${broken} broken`,
  );
  if (broken > 0) process.exitCode = 1;
}

function report(found: readonly DocLinkIssue[]) {
  const sorted = [...found].sort(
    (left, right) =>
      (left.file < right.file ? -1 : left.file > right.file ? 1 : 0) ||
      left.line - right.line ||
      left.column - right.column,
  );
  for (const issue of sorted) {
    console.error(
      `${issue.file}:${issue.line}:${issue.column} ${issue.target}: ${issue.reason}`,
    );
  }
  if (sorted.length > 0) {
    console.error(
      `error doc-links: ${sorted.length} documentation link problem(s) in ${documents.length} documents. Run \`bun run lint:doc-links -- --fix\` to link code references.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`doc-links: ${documents.length} documents, links valid`);
  }
}
