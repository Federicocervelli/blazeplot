# Security Policy

## Supported versions

Only the latest published release receives security fixes. Please upgrade to the latest version before reporting.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability. Report it privately through [GitHub private vulnerability reporting](https://github.com/Federicocervelli/blazeplot/security/advisories/new) for this repository. Include a short description, a minimal reproduction, and the affected versions.

## Scope

BlazePlot is a client-side front-end charting library. The relevant vulnerability classes are:

- Supply-chain issues: package publishing, provenance, and dependencies.
- Cross-site scripting through overlay text (labels, tooltips, annotations, legend entries) or other unsafe HTML handling.

Reports outside these classes, such as WebGL or GPU driver bugs or performance issues without a security impact, are usually out of scope.
