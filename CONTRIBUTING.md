# Contributing

Bug reports, focused fixes, and narrowly scoped improvements are welcome.
Please open an issue before starting a new platform backend or a substantial
change to the CLI, termination sequence, or report schema so compatibility
requirements can be discussed first.

## Development

Use Node.js 20.11 or newer on Linux or macOS:

```sh
npm ci
npm run check
npm run pack:check
```

`npm run check` runs linting, type checking, a clean build, unit tests, and
integration tests against short-lived local process trees. `npm run pack:check`
inspects the package that would be published.

Please add tests for behavior changes, especially around process discovery,
PID reuse, signal escalation, sampled CPU and memory limits, report privacy,
and exit-code preservation. Keep test workloads bounded and ensure every
fixture process is stopped even when an assertion fails.

## Compatibility

CLI flags, exit codes, the JSON `schemaVersion`, report fields, measurement
semantics, and termination behavior are compatibility-sensitive. Describe any
changes to these surfaces in the pull request and update the changelog.

Reports must continue to exclude command arguments, working directories,
environment data, and captured child output. A change that affects which
processes may be signaled needs platform-specific tests and a clear safety
analysis.

Keep commits focused and describe the user-visible reason for each change.
By contributing, you agree that your contribution may be distributed under
the MIT License included with this project.
