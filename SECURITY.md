# Security Policy

BlazePlot is a client-side charting library. Security issues are still possible, especially around browser APIs, package publishing, dependencies, and generated website content.

## Supported versions

Security fixes target the current `main` branch and the latest published npm version. Older versions may receive guidance, but not always a patch release.

### Proposal: support window from 1.0 (maintainer to confirm)

> This subsection is a **proposal** and is not yet policy. The maintainer should confirm or change the numbers before 1.0 is released.

Once 1.0 ships, the proposed policy is:

| Version | Receives security fixes |
|---|---|
| Latest minor of the current major | Yes |
| Previous major's last minor | Yes, for 6 months after the new major is released |
| Anything older | No; upgrade guidance only |

- Security fixes ship as patch releases of each supported line, with a changelog entry that credits the reporter if they agree.
- Response targets (proposed): acknowledge a report within 7 days, and share a fix timeline or a decision within 30 days.
- Until 1.0, only the latest `0.x` release is supported, as described above.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability.

Report security issues through GitHub's private vulnerability reporting for this repository if available, or contact the maintainer through the profile linked from the repository owner account.

Include:

- A short description of the issue.
- A minimal reproduction or affected API/page.
- Browser/package versions involved.
- Whether the issue affects runtime charts, the docs site, package publishing, or dependencies.
- Any known workaround.

## Scope examples

In scope:

- Cross-site scripting or unsafe HTML handling in the docs/demo site.
- Unsafe handling of user-provided labels, annotations, tooltip content, or exported data.
- Package publishing, provenance, or dependency-chain issues.
- Denial-of-service patterns caused by unexpectedly expensive input handling.

Usually out of scope:

- General browser WebGL availability or GPU driver bugs without a BlazePlot-specific exploit path.
- Performance reports without a security impact.
- Issues that require arbitrary code execution in the consuming application before BlazePlot is involved.

## Disclosure

The maintainer will acknowledge valid reports when possible, coordinate a fix, and publish release notes once users can upgrade safely.
