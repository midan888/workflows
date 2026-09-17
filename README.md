# Reusable workflows

Central, versioned GitHub workflows shared across `midan888` projects.

## Claude pull request review

`claude-pr-review.yml` runs a read-only Claude Code review for same-repository
pull requests and creates or updates one persistent review comment. It uses the
official Claude Code Action and authenticates with a Claude Code OAuth token
generated from a Pro or Max subscription. The Claude job receives a read-only
repository token and can only read and search files; shell commands, file edits,
web access, subagents, and repository hooks are disabled. A separate publishing
job receives only the structured review text and the repository-scoped
`GITHUB_TOKEN`, never the Claude credential.

Reviews are pinned to `claude-opus-5` at the `max` effort level. This prioritizes
review depth over latency and subscription usage; changing either setting is a
versioned shared-workflow change rather than a per-repository input.

### Use it from a project

Create `.github/workflows/claude-pr-review.yml` in the consuming repository:

```yaml
name: Claude PR Review

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
    uses: midan888/workflows/.github/workflows/claude-pr-review.yml@v3.0.0
    with:
      review_instructions: >-
        Follow AGENTS.md. Prioritize user-visible regressions and violations of
        documented cross-platform invariants.
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

Pin production callers to a release tag or full commit SHA, not `main`. Store
`CLAUDE_CODE_OAUTH_TOKEN` as an Actions secret in each repository, or as an
organization secret restricted to intended repositories.

Generate the token locally with `claude setup-token` while signed into the
intended Claude Pro or Max account. Copy it directly into the Actions secret;
never commit it or print it in a workflow. Rotate it by generating a replacement,
updating the secret, smoke-testing a review, and invalidating the old token.

For security, fork pull requests are deliberately skipped: GitHub does not
provide repository secrets to ordinary fork PR workflows, and using
`pull_request_target` would expose the personal token while reviewing untrusted
code. The official action also limits execution to repository writers by default
and blocks bot actors unless explicitly allowed. This workflow does not weaken
either restriction.

### Inputs

| Input | Type | Default | Purpose |
|---|---|---|---|
| `review_instructions` | string | Empty | Adds trusted repository-specific guidance |

The required `CLAUDE_CODE_OAUTH_TOKEN` secret is available only to the read-only
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
