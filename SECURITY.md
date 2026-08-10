# Security Policy

## Supported versions

Until the first stable release, security fixes are made on the latest
published `0.x` version only.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Email
lim@limsumin.com with:

- the affected version or commit;
- a minimal reproduction or description of the failure;
- the operating system and Node.js version;
- the likely impact; and
- any suggested mitigation.

Avoid including real credentials, sensitive command arguments, production
data, or unnecessary personal information. Do not test a report against a
path you do not own or attempt to signal processes outside a disposable test
environment. You should receive an acknowledgement within seven days. A fix
timeline will depend on severity and compatibility impact.

## Scope

Relevant reports include unintended process signaling, process-tree escape,
incorrect enforcement that can affect unrelated workloads, unsafe report-file
replacement, and disclosure of command, path, environment, or identity data
through generated reports.

`process-leash` is an operational guardrail, not a security boundary. It
samples process metadata and sends signals with the invoking user's existing
permissions. It does not sandbox commands, restrict system calls, isolate the
filesystem or network, or prevent a hostile process from attempting to evade
observation. Child output is inherited by the terminal and is not filtered.
