# Security Policy

BlazePlot is a client-side charting library. Security issues are still possible, especially around browser APIs, package publishing, dependencies, and generated website content.

## Supported versions

Security fixes target the current `main` branch and the latest published npm version. Older versions may receive guidance, but not always a patch release.

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
