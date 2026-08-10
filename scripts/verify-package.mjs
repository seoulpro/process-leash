import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = await mkdtemp(join(tmpdir(), "process-leash-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const run = (command, args, cwd) => {
  const environment = {
    ...process.env,
    NO_UPDATE_NOTIFIER: "1",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
  delete environment.npm_config_dry_run;
  delete environment.NPM_CONFIG_DRY_RUN;

  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
  return result.stdout;
};

try {
  const packageDirectory = join(temporaryRoot, "package");
  const consumerDirectory = join(temporaryRoot, "consumer");
  await mkdir(packageDirectory);
  await mkdir(consumerDirectory);

  const [packed] = JSON.parse(
    run(
      npm,
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        packageDirectory,
      ],
      projectRoot,
    ),
  );
  assert.ok(packed?.filename, "npm pack did not return a filename");
  assert.equal(packed.name, "process-leash");

  const packedPaths = new Set(packed.files.map((file) => file.path));
  for (const expected of [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "dist/cli.js",
    "dist/report.js",
    "dist/supervisor.js",
    "package.json",
  ]) {
    assert.ok(packedPaths.has(expected), `package is missing ${expected}`);
  }
  for (const packedPath of packedPaths) {
    assert.doesNotMatch(
      packedPath,
      /(^|\/)(?:\.github|node_modules|scripts|src|test)(?:\/|$)/u,
    );
  }

  const archive = join(packageDirectory, packed.filename);
  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );
  run(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      archive,
    ],
    consumerDirectory,
  );

  const installedManifest = JSON.parse(
    await readFile(
      join(consumerDirectory, "node_modules", "process-leash", "package.json"),
      "utf8",
    ),
  );
  assert.equal(installedManifest.version, packed.version);
  assert.equal(installedManifest.dependencies, undefined);

  const executable = join(
    consumerDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "process-leash.cmd" : "process-leash",
  );
  assert.equal(
    run(executable, ["--version"], consumerDirectory).trim(),
    packed.version,
  );
  run(
    executable,
    [
      "--timeout",
      "2s",
      "--quiet",
      "--",
      process.execPath,
      "--eval",
      "process.exit(0)",
    ],
    consumerDirectory,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
