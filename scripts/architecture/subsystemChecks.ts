import { type ArchitectureCheck, createListCheck } from "./checkFactories";
import {
  findSubsystemLayerViolations,
  subsystemLayerBaselinePath,
} from "./subsystemLayers";
import {
  findSubsystemSurfaceViolations,
  subsystemSurfaceBaselinePath,
} from "./subsystemSurfaces";
import {
  findSubsystemCoverageViolations,
  findSubsystemDocsViolations,
} from "./subsystems";
import {
  findSubsystemTableViolations,
  subsystemTableBaselinePath,
} from "./subsystemTables";

/** The subsystem registry checks run by `bun run lint:architecture`. */
export const subsystemChecks: readonly ArchitectureCheck[] = [
  createListCheck({
    findItems: findSubsystemCoverageViolations,
    formatItem: (violation) =>
      violation.matchedSubsystems.length === 0
        ? `${violation.filePath}: not claimed by any subsystem`
        : `${violation.filePath}: claimed by multiple subsystems (${violation.matchedSubsystems.join(", ")})`,
    message:
      "Every production source file in a registered package should map to exactly one subsystem in scripts/architecture/subsystems.ts (client SDK rows: clientSdkSubsystems.ts). Add the file to the owning subsystem's paths (or a new subsystem) and document it in docs/subsystems.md.",
    name: "subsystem-registry-covers-every-source-file",
  }),
  createListCheck({
    findItems: findSubsystemDocsViolations,
    formatItem: (violation) => `${violation.name} ${violation.detail}`,
    message:
      "The docs/subsystems.md registry table and scripts/architecture/subsystems.ts should list the same subsystems.",
    name: "subsystem-registry-matches-docs",
  }),
  createListCheck({
    findItems: findSubsystemSurfaceViolations,
    formatItem: (violation) => violation,
    message: `Other subsystems import only the files in a subsystem's declared surface. Import through its facade, or add a deliberate contract module to the surface. Older deep imports are listed in ${subsystemSurfaceBaselinePath}, which only shrinks.`,
    name: "subsystem-imports-use-declared-surface",
  }),
  createListCheck({
    findItems: findSubsystemTableViolations,
    formatItem: (violation) => violation,
    message: `Only the subsystem that owns a SQLite table imports it from the schema or names it in raw SQL. Reach another subsystem's data through its surface. Older uses are listed in ${subsystemTableBaselinePath}, which only shrinks.`,
    name: "subsystem-uses-own-tables",
  }),
  createListCheck({
    findItems: findSubsystemLayerViolations,
    formatItem: (violation) => violation,
    message: `A client SDK production file imports at runtime only from subsystems ranked below its own in scripts/architecture/clientSdkLayers.ts: lower subsystem layers, or earlier in its own subsystem layer. Move the shared contract down or pass a host interface. Older back-edges are listed in ${subsystemLayerBaselinePath}, which only shrinks.`,
    name: "subsystem-imports-follow-layer-order",
  }),
];
