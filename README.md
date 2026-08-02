# 🪢 process-leash

Run a command under wall-clock, memory, and CPU limits, and stop the whole process tree when one of
them is crossed.

```sh
process-leash --timeout 10m --memory 2GiB -- npm test
```

`process-leash` samples the entire tree your command spawns, not just the process you started. When
a limit is breached it terminates that tree gracefully before forcing it. Optional JSON and
Markdown reports deliberately contain none of your command line, environment, or output. It is
built for test and build commands that occasionally hang or eat the machine — give them a long
leash, not an infinite one.

## Quickstart

Requires Node.js 20.11 or newer on Linux or macOS. Nothing has been published to a package registry,
so install from a checkout:

```sh
npm install
npm run build
npm link
```

Then wrap a command you want to bound:

```sh
process-leash --timeout 5m --memory 2GiB --markdown incident.md -- npm test
```

## Usage

```text
process-leash [options] -- <command> [arguments...]
```

At least one limit is required, and the `--` separator is required.

| Option | Default | Description |
| --- | --- | --- |
| `-t, --timeout <duration>` | — | Wall-clock limit for the whole run |
| `-m, --memory <size>` | — | Resident memory summed across the process tree |
| `-c, --cpu <percent>` | — | Sustained CPU across the tree; `100%` is one logical core |
| `--cpu-window <duration>` | `3s` | How long CPU must stay over the limit before it counts |
| `--grace <duration>` | `2s` | Delay between `SIGTERM` and `SIGKILL` |
| `--interval <duration>` | `250ms` | Sampling interval, minimum `50ms` |
| `--json <path>` | — | Write a JSON report |
| `--markdown <path>` | — | Write a Markdown report |
| `-q, --quiet` | — | Suppress the final summary line |
| `-h, --help` / `-V, --version` | — | Show help or version |

Durations use `ms`, `s`, `m`, or `h` and accept fractions (`1.5s`). Sizes use decimal `KB`/`MB`/`GB`
or binary `KiB`/`MiB`/`GiB`. CPU accepts `250%` or `250`.

Everything after `--` is passed straight to the executable with no shell, including any further
`--`:

```sh
# Jest: a stuck worker should not hold the machine for an hour
process-leash --timeout 10m --memory 4GiB -- npx jest --runInBand

# Vitest: catch a spec that spins instead of finishing
process-leash --timeout 5m --cpu 250% --cpu-window 15s -- npx vitest run

# Playwright: browsers are where the memory goes, so limit the tree
process-leash --timeout 15m --memory 6GiB --markdown incident.md -- npx playwright test

# Arguments after the first -- stay opaque
process-leash --timeout 2m -- npm test -- --runInBand
```

If you need shell syntax, ask for a shell:

```sh
process-leash --timeout 2m -- sh -c 'npm run build && npm test'
```

## What happens at a limit

The command starts in its own process group. `process-leash` also follows parent relationships and
remembers process identities, so descendants that reparent or leave the group after being observed
are still signaled.

1. Print a warning to stderr.
2. Send `SIGTERM` to the process group and to every descendant observed so far.
3. Poll for up to `--grace`, checking whether the tree is gone.
4. Send `SIGKILL` to anything still alive.

`SIGINT`, `SIGTERM`, and `SIGHUP` received by `process-leash` are forwarded to the tree the same way.
Unless `-q` is passed, a summary line goes to stderr when the run ends:

```text
process-leash: limit-exceeded | exit=124 | 10.02m | peak RSS=4.21 GiB | peak CPU=180.4% | peak processes=9
```

## Exit codes

| Code | Meaning |
| --- | --- |
| the command's own code | The command ran to completion |
| `124` | A limit was breached |
| `125` | Measurement or report writing failed, or the platform is unsupported |
| `126` | The command could not be executed |
| `127` | The command was not found |
| `128 + n` | The run ended on signal `n` — either the command was killed by it, or `process-leash` received `SIGINT`, `SIGTERM`, or `SIGHUP` and forwarded it to the tree |
| `2` | Invalid usage |

## Reports

```sh
process-leash \
  --timeout 5m \
  --memory 1GiB \
  --json report.json \
  --markdown report.md \
  -- npm test
```

Reports carry the outcome and reason, the platform and its measurement source, start and end times,
the limits in effect, peak tree RSS, peak CPU, peak process count, the breach, the termination steps
taken, and the exit status. JSON reports include a `schemaVersion` field, currently `1`. Markdown
reports are titled *Incident Report* after a breach and *Execution Report* otherwise.

Reports deliberately exclude:

- the executable name and every command argument
- the working directory and other local paths
- environment variable names and values
- child stdout and stderr
- hostnames and user identities

Child stdio is inherited rather than captured, and report files are written atomically with mode
`0600`. The command itself can still print secrets to the terminal it inherited, which remains your
responsibility.

## Platform support

| Platform | Measurement |
| --- | --- |
| Linux | `/proc/<pid>/stat` |
| macOS | BSD `ps` process table |
| Windows | Not implemented |

Process discovery and signaling sit behind a small platform interface, so a Windows Job Objects
backend can be added without changing the CLI or the report schema.

## Limitations

- **Not a security boundary.** This is an operational guardrail. It observes and signals; it does not
  contain, and it will not stop a process that is actively trying to escape it.
- **Peaks are sampled, not exact.** Very short-lived processes that start and exit between two
  samples can be missed entirely.
- **Shared memory is double counted.** RSS is summed per process, so pages shared across the tree may
  be counted more than once.
- **Escape before first observation is possible.** A descendant that leaves the process group before
  any sample observes it will not be tracked.
- **CPU is aggregate, not per-core-normalized.** `100%` is one logical core, so a healthy parallel
  tree will legitimately exceed it. Set `--cpu` accordingly.

Where you have the privileges for them, kernel-level controls are stronger:
[`prlimit`](https://man7.org/linux/man-pages/man1/prlimit.1.html) applies per-process rlimits, and
[`systemd-run`](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html) applies
cgroup controls on systemd hosts.
[GNU `timeout`](https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html) is
the mature choice when a wall clock is all you need. `process-leash` trades containment for an
unprivileged wrapper that combines tree RSS, sustained tree CPU, and a report you can attach to a
bug.

## Development

```sh
npm run lint
npm run typecheck
npm test         # builds, then runs the test suite
npm run check    # all three
npm run pack:check
```

Tests combine synthetic process-table records, for deterministic accounting and unit parsing, with
small local fixtures that exercise exit-code preservation, escalation against an uncooperative tree,
CPU and RSS enforcement, and report redaction.

## Status

Version 0.1.0. The report schema is versioned; the CLI surface may still change.

## License

Licensed under the [MIT License](LICENSE).
