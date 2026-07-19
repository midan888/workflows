# Reusable workflows

Central, versioned GitHub workflows shared across `midan888` projects.

## Weekly AI codebase audit

The reusable audit is authored as a
[GitHub Agentic Workflow](https://github.github.com/gh-aw/) and compiled into a
standard GitHub Actions reusable workflow.

It performs a read-only repository review and can create at most one
evidence-backed improvement issue per run. It cannot modify code, create pull
requests, or close issues. No-op runs and infrastructure failures remain in the
Actions run summary instead of creating noise issues.

### Use it from a project

Create `.github/workflows/weekly-codebase-audit.yml` in the consuming repository:

```yaml
name: Weekly AI Codebase Audit

on:
  schedule:
    - cron: "37 6 * * 1"
  workflow_dispatch:

permissions:
  actions: read
  contents: read
  issues: write
  pull-requests: read
  security-events: read
  vulnerability-alerts: read

jobs:
  audit:
    uses: midan888/workflows/.github/workflows/weekly-codebase-audit.lock.yml@v2.0.4
    with:
      project_context: >-
        Read and respect this repository's AGENTS.md, contribution guidance,
        and architecture documentation.
      audit_focus: >-
        correctness, security, reliability, tests, maintainability, CI/CD,
        deployment, dependencies, and documentation
      minimum_severity: medium
      max_findings: 10
    secrets:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Pin production callers to a release tag or full commit SHA. Do not reference
`main`, because that would apply central workflow changes without an explicit
consumer upgrade.

The workflow uses OpenAI Codex with the explicit `gpt-5.6-sol` model. Every
consuming repository must provide an `OPENAI_API_KEY` Actions secret. For several
repositories, prefer an organization secret restricted to the intended callers.

### Inputs

| Input | Type | Default | Purpose |
|---|---|---|---|
| `project_context` | string | Read repository instructions | Supplies constraints the audit must respect |
| `audit_focus` | string | Broad engineering review | Selects areas to prioritize |
| `minimum_severity` | string | `medium` | Suppresses lower-value findings |
| `max_findings` | number | `12` | Caps the consolidated issue size |

### Maintenance

Install GitHub's official compiler, edit the Markdown source, and regenerate the
lock file. The current workflow requires `gh-aw` v0.82.13 or newer for GPT-5.6
model metadata and firewall support:

```bash
gh extension install github/gh-aw --pin v0.82.13
gh aw compile weekly-codebase-audit --validate --actionlint
```

Commit both files together:

- `.github/workflows/weekly-codebase-audit.md` — human-authored source
- `.github/workflows/shared/gpt-5.6-sol.md` — exact-model routing override
- `.github/workflows/weekly-codebase-audit.lock.yml` — generated executable

Release breaking changes under a new major version. Recompile after upgrading
the `gh-aw` compiler so generated actions remain current and SHA-pinned.
