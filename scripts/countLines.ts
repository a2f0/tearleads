#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Row = {
  blank: number;
  code: number;
  comment: number;
  files: number;
  language: string;
};

type Stats = Omit<Row, "language">;

type FileStats = Stats & {
  language: string;
  name: string;
};

type ModuleRow = {
  module: string;
  source: Stats;
  test: Stats;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const result = spawnSync(
  "tokei",
  ["--output", "json", "--sort", "code", "--files", ...process.argv.slice(2)],
  { cwd: rootDir, encoding: "utf8", maxBuffer: 10 * 1_024 * 1_024 },
);

if (result.error) {
  if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
    console.error("Error: tokei is not installed");
    console.error("Install with: sudo apt install tokei");
    console.error("Or with Cargo: cargo install tokei");
  } else {
    console.error(`Error running tokei: ${result.error.message}`);
  }
  process.exit(1);
}

if (typeof result.status === "number" && result.status !== 0) {
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (stderr) {
    console.error(stderr);
  }
  process.exit(result.status);
}

const output = typeof result.stdout === "string" ? result.stdout : "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseTokeiOutput = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    if (isRecord(parsed)) {
      return parsed;
    }

    console.error("Error parsing tokei output: output is not a JSON object");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error parsing tokei output: ${message}`);
  }

  process.exit(1);
};

const data = parseTokeiOutput(output);
const formatter = new Intl.NumberFormat("en-US");

const isTestFile = (filePath: string): boolean => {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const pathSegments = normalizedPath.split("/");
  const basename = pathSegments.at(-1) ?? normalizedPath;

  return (
    pathSegments.some((segment) =>
      ["__tests__", "e2e", "test", "tests"].includes(segment),
    ) || /(?:^|\.)(?:bench|spec|test)\.[^.]+$/u.test(basename)
  );
};

const readStat = (stats: unknown, key: string): number => {
  if (!isRecord(stats)) {
    return 0;
  }

  const value = stats[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return 0;
};

const readFileStats = (language: string, report: unknown): FileStats | null => {
  if (!isRecord(report)) {
    return null;
  }

  const { name, stats } = report;
  if (typeof name !== "string") {
    return null;
  }

  return {
    language,
    name,
    files: 1,
    blank: readStat(stats, "blanks"),
    comment: readStat(stats, "comments"),
    code: readStat(stats, "code"),
  };
};

const collectLanguageFileStats = (
  language: string,
  stats: unknown,
): FileStats[] => {
  if (!isRecord(stats)) {
    return [];
  }

  const { reports: reportEntries } = stats;
  const reports = Array.isArray(reportEntries) ? reportEntries : [];
  return reports.flatMap((report) => {
    const fileStats = readFileStats(language, report);
    return fileStats ? [fileStats] : [];
  });
};

const addStats = (left: Stats, right: Stats): Stats => ({
  files: left.files + right.files,
  blank: left.blank + right.blank,
  comment: left.comment + right.comment,
  code: left.code + right.code,
});

const emptyStats = (): Stats => ({
  files: 0,
  blank: 0,
  comment: 0,
  code: 0,
});

const createRows = (fileStats: FileStats[]): Row[] => {
  const statsByLanguage = new Map<string, Stats>();
  let totalStats = emptyStats();

  for (const stats of fileStats) {
    const currentStats = statsByLanguage.get(stats.language) ?? emptyStats();
    const nextStats = addStats(currentStats, stats);
    statsByLanguage.set(stats.language, nextStats);
    totalStats = addStats(totalStats, stats);
  }

  const rows = Array.from(statsByLanguage.entries())
    .map(([language, stats]) => ({ language, ...stats }))
    .sort((a, b) => b.code - a.code);

  rows.push({
    language: "Total",
    ...totalStats,
  });

  return rows;
};

const moduleNameForFile = (filePath: string): string => {
  const normalizedPath = filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
  const normalizedRoot = rootDir.replaceAll("\\", "/");
  const relativePath = normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
  const [firstSegment, secondSegment] = relativePath.split("/");

  if (firstSegment === "packages" && secondSegment) {
    return `packages/${secondSegment}`;
  }

  return secondSegment ? (firstSegment ?? "(root)") : "(root)";
};

const createModuleRows = (stats: FileStats[]): ModuleRow[] => {
  const rowsByModule = new Map<string, Omit<ModuleRow, "module">>();
  let totalSource = emptyStats();
  let totalTest = emptyStats();

  for (const file of stats) {
    const module = moduleNameForFile(file.name);
    const current = rowsByModule.get(module) ?? {
      source: emptyStats(),
      test: emptyStats(),
    };

    if (isTestFile(file.name)) {
      current.test = addStats(current.test, file);
      totalTest = addStats(totalTest, file);
    } else {
      current.source = addStats(current.source, file);
      totalSource = addStats(totalSource, file);
    }

    rowsByModule.set(module, current);
  }

  const rows = Array.from(rowsByModule.entries())
    .map(([module, moduleStats]) => ({ module, ...moduleStats }))
    .sort(
      (left, right) =>
        right.source.code +
          right.test.code -
          (left.source.code + left.test.code) ||
        left.module.localeCompare(right.module),
    );

  rows.push({
    module: "Total",
    source: totalSource,
    test: totalTest,
  });

  return rows;
};

const fileStats = Object.entries(data)
  .filter(([name]) => name !== "Total")
  .flatMap(([language, stats]) => collectLanguageFileStats(language, stats));

const sourceRows = createRows(
  fileStats.filter((stats) => !isTestFile(stats.name)),
);
const testRows = createRows(
  fileStats.filter((stats) => isTestFile(stats.name)),
);

const formatNumber = (value: number): string => formatter.format(value);

const headers = {
  language: "Language",
  files: "Files",
  blank: "Blank",
  comment: "Comment",
  code: "Code",
};

const moduleHeaders = {
  module: "Module",
  sourceFiles: "Src files",
  sourceCode: "Src code",
  testFiles: "Test files",
  testCode: "Test code",
  totalCode: "Total code",
  testRatio: "Test/src",
};

const padRight = (value: string, width: number): string => value.padEnd(width);
const padLeft = (value: string, width: number): string => value.padStart(width);

const printTable = (title: string, rows: Row[]): void => {
  const columnWidths = rows.reduce(
    (widths, row) => ({
      language: Math.max(widths.language, row.language.length),
      files: Math.max(widths.files, formatNumber(row.files).length),
      blank: Math.max(widths.blank, formatNumber(row.blank).length),
      comment: Math.max(widths.comment, formatNumber(row.comment).length),
      code: Math.max(widths.code, formatNumber(row.code).length),
    }),
    {
      language: headers.language.length,
      files: headers.files.length,
      blank: headers.blank.length,
      comment: headers.comment.length,
      code: headers.code.length,
    },
  );

  const headerLine = [
    padRight(headers.language, columnWidths.language),
    padLeft(headers.files, columnWidths.files),
    padLeft(headers.blank, columnWidths.blank),
    padLeft(headers.comment, columnWidths.comment),
    padLeft(headers.code, columnWidths.code),
  ].join("  ");

  const separatorLine = [
    "-".repeat(columnWidths.language),
    "-".repeat(columnWidths.files),
    "-".repeat(columnWidths.blank),
    "-".repeat(columnWidths.comment),
    "-".repeat(columnWidths.code),
  ].join("  ");

  console.log(title);
  console.log(headerLine);
  console.log(separatorLine);

  rows.forEach((row) => {
    const line =
      `${padRight(row.language, columnWidths.language)}  ` +
      `${padLeft(formatNumber(row.files), columnWidths.files)}  ` +
      `${padLeft(formatNumber(row.blank), columnWidths.blank)}  ` +
      `${padLeft(formatNumber(row.comment), columnWidths.comment)}  ` +
      `${padLeft(formatNumber(row.code), columnWidths.code)}`;

    console.log(line);
  });
};

const formatRatio = (testCode: number, sourceCode: number): string =>
  sourceCode === 0 ? "n/a" : `${Math.round((testCode / sourceCode) * 100)}%`;

const printModuleTable = (rows: ModuleRow[]): void => {
  const displayRows = rows.map((row) => ({
    module: row.module,
    sourceFiles: formatNumber(row.source.files),
    sourceCode: formatNumber(row.source.code),
    testFiles: formatNumber(row.test.files),
    testCode: formatNumber(row.test.code),
    totalCode: formatNumber(row.source.code + row.test.code),
    testRatio: formatRatio(row.test.code, row.source.code),
  }));
  const columnWidths = displayRows.reduce(
    (widths, row) => ({
      module: Math.max(widths.module, row.module.length),
      sourceFiles: Math.max(widths.sourceFiles, row.sourceFiles.length),
      sourceCode: Math.max(widths.sourceCode, row.sourceCode.length),
      testFiles: Math.max(widths.testFiles, row.testFiles.length),
      testCode: Math.max(widths.testCode, row.testCode.length),
      totalCode: Math.max(widths.totalCode, row.totalCode.length),
      testRatio: Math.max(widths.testRatio, row.testRatio.length),
    }),
    Object.fromEntries(
      Object.entries(moduleHeaders).map(([key, value]) => [key, value.length]),
    ) as Record<keyof typeof moduleHeaders, number>,
  );
  const alignedValues = (
    values: Record<keyof typeof moduleHeaders, string>,
    fill = " ",
  ): string[] =>
    Object.keys(moduleHeaders).map((key, index) => {
      const column = key as keyof typeof moduleHeaders;
      const value = values[column];
      const width = columnWidths[column];
      return index === 0
        ? value.padEnd(width, fill)
        : value.padStart(width, fill);
    });

  console.log("Per-module code");
  console.log(alignedValues(moduleHeaders).join("  "));
  console.log(
    alignedValues(
      Object.fromEntries(
        Object.keys(moduleHeaders).map((key) => [
          key,
          "-".repeat(columnWidths[key as keyof typeof moduleHeaders]),
        ]),
      ) as Record<keyof typeof moduleHeaders, string>,
    ).join("  "),
  );
  displayRows.forEach((row) => {
    console.log(alignedValues(row).join("  "));
  });
};

printTable("Source files", sourceRows);
console.log("");
printTable("Test files", testRows);
console.log("");
printModuleTable(createModuleRows(fileStats));
