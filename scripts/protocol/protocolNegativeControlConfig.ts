import type {
  ExpectedViolation,
  NegativeControl,
} from "./protocolNegativeControls";

export interface ParsedConfig {
  readonly specification: string;
  readonly constants: readonly (readonly [string, string])[];
  readonly invariants: readonly string[];
  readonly properties: readonly string[];
}

const KEYWORD_PATTERN =
  /^(SPECIFICATION|CONSTANTS?|INVARIANTS?|PROPERTY|PROPERTIES)\b\s*(.*)$/;
const ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/;

interface ConfigBuilder {
  specification: string;
  readonly constants: (readonly [string, string])[];
  readonly invariants: string[];
  readonly properties: string[];
  section: "constants" | "other";
}

function applyKeywordLine(
  builder: ConfigBuilder,
  word: string,
  remainder: string,
  index: number,
): void {
  builder.section = "other";
  if (word === "SPECIFICATION") {
    builder.specification = remainder;
  } else if (word === "CONSTANT" || word === "CONSTANTS") {
    builder.section = "constants";
    if (remainder !== "") {
      builder.constants.push(parseAssignment(remainder, index));
    }
  } else if (word === "INVARIANT" || word === "INVARIANTS") {
    builder.invariants.push(...remainder.split(/\s+/).filter(Boolean));
  } else {
    builder.properties.push(...remainder.split(/\s+/).filter(Boolean));
  }
}

/**
 * Reads the subset of TLC's configuration grammar the registered
 * configurations use: one SPECIFICATION, CONSTANT assignments inline or in
 * an indented block, and INVARIANT/PROPERTY names. Anything else fails so a
 * configuration feature the renderer cannot reproduce is never silently
 * dropped from a control.
 */
export function parseConfig(source: string): ParsedConfig {
  const builder: ConfigBuilder = {
    specification: "",
    constants: [],
    invariants: [],
    properties: [],
    section: "other",
  };

  for (const [index, rawLine] of source.split("\n").entries()) {
    const line = rawLine.replace(/\\\*.*$/, "").trim();
    if (line === "") {
      continue;
    }
    const keyword = line.match(KEYWORD_PATTERN);
    if (keyword) {
      applyKeywordLine(
        builder,
        keyword[1] ?? "",
        (keyword[2] ?? "").trim(),
        index,
      );
    } else if (builder.section === "constants") {
      builder.constants.push(parseAssignment(line, index));
    } else {
      throw new Error(
        `configuration line ${index + 1} is not supported by the negative-control renderer: ${line}`,
      );
    }
  }

  if (builder.specification === "") {
    throw new Error("configuration declares no SPECIFICATION.");
  }
  const { specification, constants, invariants, properties } = builder;
  return { specification, constants, invariants, properties };
}

function parseAssignment(
  line: string,
  index: number,
): readonly [string, string] {
  const match = line.match(ASSIGNMENT_PATTERN);
  if (!match?.[1] || !match[2]) {
    throw new Error(
      `configuration line ${index + 1} is not a constant assignment: ${line}`,
    );
  }
  return [match[1], match[2].trim()];
}

/**
 * The control's configuration: the registered constants with the control's
 * overrides applied, and only the expected invariant or property, so the
 * violation TLC reports is the one the control names. An override of a
 * constant the base does not assign, or an expectation the base does not
 * check, is a registry error rather than a silently vacuous control.
 */
export function renderNegativeControlConfig(
  base: ParsedConfig,
  control: NegativeControl,
): string {
  const assigned = new Set(base.constants.map(([name]) => name));
  for (const name of Object.keys(control.constants)) {
    if (!assigned.has(name)) {
      throw new Error(
        `${control.id} overrides ${name}, which ${control.config} does not assign.`,
      );
    }
  }
  const checked =
    control.expect.kind === "invariant" ? base.invariants : base.properties;
  if (!checked.includes(control.expect.name)) {
    throw new Error(
      `${control.id} expects ${control.expect.kind} ${control.expect.name}, which ${control.config} does not check.`,
    );
  }
  const constants = base.constants.map(
    ([name, value]) => `  ${name} = ${control.constants[name] ?? value}`,
  );
  const check =
    control.expect.kind === "invariant"
      ? `INVARIANT ${control.expect.name}`
      : `PROPERTY ${control.expect.name}`;
  return `SPECIFICATION ${base.specification}\n\nCONSTANTS\n${constants.join("\n")}\n\n${check}\n`;
}

/** The exact TLC report the control must produce. */
export function violationPattern(expect: ExpectedViolation): RegExp {
  switch (expect.kind) {
    case "invariant":
      return new RegExp(
        `^Error: Invariant ${expect.name} is violated\\.$`,
        "m",
      );
    case "action":
      return new RegExp(
        `^Error: Action property ${expect.name} is violated\\.$`,
        "m",
      );
    case "liveness":
      return /^Error: Temporal properties were violated\.$/m;
  }
}
