# Changelog

Notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-10

### Added

- Wall-clock, aggregate process-tree RSS, and sustained process-tree CPU limits.
- Linux and macOS process discovery with graceful termination and forced cleanup.
- Exit-code preservation and distinct codes for limit, launch, usage, and monitor failures.
- Privacy-minimized JSON and Markdown execution reports with atomic replacement.
- Unit and integration coverage for process tracking, limit enforcement, and report redaction.

### Fixed

- Prevented JSON and Markdown reports from resolving to the same output path.
- Created report temporary files exclusively and removed them after failed replacement.
- Scheduled wall-clock limits longer than the runtime's maximum single timer delay safely.
