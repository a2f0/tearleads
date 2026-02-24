#!/usr/bin/env tsx
import {
  formatMarkdownReport,
  parseCliOptions,
  resolveCandidateSha,
  runQaSuiteChecks,
  writeReportFile
} from './vfsSecureUploadQaSuite.js';

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv);
  const candidateSha = resolveCandidateSha(process.env['GITHUB_SHA']);
  const { report } = await runQaSuiteChecks(options, candidateSha);

  if (options.reportJsonPath) {
    writeReportFile(
      options.reportJsonPath,
      `${JSON.stringify(report, null, 2)}\n`
    );
    console.log(`JSON report written: ${options.reportJsonPath}`);
  }

  if (options.reportMarkdownPath) {
    writeReportFile(options.reportMarkdownPath, formatMarkdownReport(report));
    console.log(`Markdown report written: ${options.reportMarkdownPath}`);
  }

  if (!options.dryRun && report.failed > 0) {
    process.exit(1);
  }
}

void main();
