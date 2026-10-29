/**
 * A subsystem names a vertical slice or platform concern and indexes its paths.
 * Import direction stays enforced by `dependency-cruiser.config.ts` (lanes,
 * layers, planes). A subsystem may span several layers (e.g. Containers spans
 * routes/, services/, and orchestration workflows), which is exactly the
 * scatter the registry makes greppable. A subsystem that declares a `surface`
 * is also a boundary: other subsystems may import only those files.
 *
 * See `docs/subsystems.md` for the human-facing table and AGENTS.md
 * "## Subsystems" for how this term relates to plane/layer/lane/facade.
 */
export interface Subsystem {
  /** Stable proper noun used in docs, PR descriptions, and conversation. */
  readonly name: string;
  /** Owning package short name (matches the keys in `packageSourcePath`). */
  readonly package: string;
  /** One-line statement of what the subsystem owns. */
  readonly responsibility: string;
  /** The public seam callers should reach for, in prose. */
  readonly seam: string;
  /**
   * Path prefixes (directories, written with a trailing `/`) and exact files the
   * subsystem owns. Across a registered package these must partition every
   * production source file with no overlaps and no gaps; the partition is
   * enforced by the `*-subsystem-registry-covers-every-source-file` lint check.
   */
  readonly paths: readonly string[];
  /**
   * The files other subsystems may import, written like `paths`: its facade
   * indexes and the contract modules it deliberately exposes. Enforced by the
   * `subsystem-imports-use-declared-surface` lint check, with older deep
   * imports listed in `subsystemSurfaceBaseline.json`. Omitted, any file may be
   * imported, as for platform subsystems such as SQLite Runtime.
   */
  readonly surface?: readonly string[];
  /**
   * The SQLite tables the subsystem owns, by `sqliteTable` export name. Only
   * the owner writes them; others read only those in `readableTables` and
   * otherwise go through the owner's surface. Enforced by
   * `subsystem-uses-own-tables`, with older uses in `subsystemTableBaseline.json`.
   */
  readonly tables?: readonly string[];
  readonly readableTables?: readonly string[];
}
