const exitCode = Number(process.argv[2] ?? 0);
process.exit(Number.isInteger(exitCode) ? exitCode : 1);
