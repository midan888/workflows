# Reusable workflows

Central, versioned GitHub workflows shared across `midan888` projects.

## Codex pull request review

`codex-pr-review.yml` runs a read-only Codex review for same-repository pull
requests and creates or updates one persistent review comment. It authenticates
ephemerally with a Codex personal access token, uses the official Codex GitHub
Action, drops `sudo`, denies tool network access, and prevents shell commands
from inheriting `CODEX_ACCESS_TOKEN`. It also marks the checkout untrusted and
disables automatic `AGENTS.md` loading, so pull-request changes cannot inject
higher-priority project configuration or instructions; Codex reads contributor
guidance only as review evidence. The separate publishing job receives only the
final review text and the repository-scoped `GITHUB_TOKEN`.

### Use it from a project

Create `.github/workflows/codex-pr-review.yml` in the consuming repository:

```yaml
name: Codex PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  issues: write
  pull-requests: write

jobs:
  review:
    if: github.event.pull_request.draft == false
    uses: midan888/workflows/.github/workflows/codex-pr-review.yml@v2.2.0
    with:
      review_instructions: >-
        Follow AGENTS.md. Prioritize user-visible regressions and violations of
        documented cross-platform invariants.
    secrets:
      CODEX_ACCESS_TOKEN: ${{ secrets.CODEX_ACCESS_TOKEN }}
```

Pin production callers to a release tag or full commit SHA, not `main`. Store
`CODEX_ACCESS_TOKEN` as an Actions secret in each repository, or as an
organization secret restricted to intended repositories.

Create the token from the ChatGPT **Access tokens** page with the Codex scope
and a finite expiry. Rotate it by creating a replacement, updating the Actions
secret, smoke-testing a review, and revoking the old token. The workflow pins
Codex CLI `0.145.0`; raise that pin when a newly created token requires a newer
minimum CLI version.

For security, fork pull requests are deliberately skipped: GitHub does not
provide repository secrets to ordinary fork PR workflows, and using
`pull_request_target` would expose the personal token while reviewing untrusted
code. The official action also limits execution to repository writers by
default. Use `allow_users` or `allow_bots` only for identities you trust.

### Inputs

| Input | Type | Default | Purpose |
|---|---|---|---|
| `model` | string | `gpt-5.6-sol` | Selects the Codex model |
| `reasoning_effort` | string | `high` | Sets review reasoning effort |
| `review_instructions` | string | Empty | Adds trusted repository-specific guidance |
| `allow_users` | string | Empty | Adds trusted triggering users to the action allowlist |
| `allow_bots` | boolean | `false` | Allows trusted bot-triggered runs |

The required `CODEX_ACCESS_TOKEN` secret is available only to the read-only
review job. The workflow supports `pull_request` callers only and updates the
same comment after each new PR commit instead of creating comment spam.

## Weekly AI codebase audit

The reusable audit is authored as a
[GitHub Agentic Workflow](https://github.github.com/gh-aw/) and compiled into a
standard GitHub Actions reusable workflow.

It performs a read-only repository review and can create up to 12 separate,
evidence-backed improvement issues per run—one issue per independent root cause.
It cannot modify code, create pull requests, or close issues. Exact issue titles
are deduplicated, and no-op runs or infrastructure failures remain in the Actions
run summary instead of creating noise issues.

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
    uses: midan888/workflows/.github/workflows/weekly-codebase-audit.lock.yml@v2.1.0
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
| `max_findings` | number | `12` | Caps separate finding issues per run (hard limit 12) |

The audit provides Go 1.25 and Node.js 24 to the isolated agent and permits
repository-documented Go tests and npm checks. Other ecosystems remain available
for source review but need a future runtime/tool addition before their build
commands can execute.

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
