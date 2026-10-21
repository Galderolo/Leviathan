# Security policy

Please **do not** open a public issue for security problems.

Report vulnerabilities privately through GitHub's [security advisories](https://github.com/leviathan-git/leviathan/security/advisories/new). Include the steps to reproduce and, if possible, the Leviathan and Git versions you used. We will acknowledge the report as soon as we can and keep you informed while it is fixed.

## Scope notes

Leviathan runs your installed `git` executable inside the repositories you open. Like the git command line itself, opening an untrusted repository can run code configured by that repository (for example hooks, or settings such as `core.fsmonitor`). Only open repositories you trust, and see Git's own [security documentation](https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory) about `safe.directory`.
