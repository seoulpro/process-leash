#!/usr/bin/env node
import { HELP, VERSION, UsageError, parseCliArgs } from "./args.js";
import { createProcessTable } from "./platform/index.js";
import { writeReports } from "./report.js";
import { renderSummary } from "./summary.js";
import { supervise } from "./supervisor.js";

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    const message = error instanceof UsageError ? error.message : "arguments could not be parsed";
    process.stderr.write(`process-leash: ${message}\nTry 'process-leash --help' for usage.\n`);
    return 2;
  }

  if (parsed.action === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (parsed.action === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  let table;
  try {
    table = await createProcessTable();
  } catch {
    process.stderr.write("process-leash: process measurement is unavailable on this platform\n");
    return 125;
  }

  const report = await supervise(parsed.options, { table }, {
    warn: (message) => process.stderr.write(`${message}\n`),
  });

  try {
    await writeReports(
      report,
      parsed.options.jsonReportPath,
      parsed.options.markdownReportPath,
    );
  } catch {
    process.stderr.write("process-leash: a requested report could not be written\n");
    return 125;
  }

  if (!parsed.options.quiet) process.stderr.write(`${renderSummary(report)}\n`);
  return report.exit.wrapperCode;
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
