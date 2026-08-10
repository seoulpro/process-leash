## Summary

<!-- What this change does and why. Link the issue it resolves, if any. -->

## Checklist

- [ ] `npm ci && npm run check && npm run pack:check` passes.
- [ ] Tests cover relevant process discovery, enforcement, and cleanup paths.
- [ ] Test workloads are bounded and leave no fixture processes running.
- [ ] Reports still exclude command, path, environment, identity, and child-output data.
- [ ] CLI, exit-code, report-schema, measurement, or termination changes are described above.
- [ ] User-visible changes update the changelog and documentation.
