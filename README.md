# Reusable workflows

Central, versioned GitHub workflows shared across `midan888` projects.

## OpenRouter pull request review

`openrouter-pr-review.yml` runs a read-only GLM 5.3 review for same-repository
pull requests and creates or updates one persistent review comment. It uses the
official Claude Code Action as the agent harness and sends its Anthropic-compatible
API traffic to OpenRouter. The review job receives a read-only repository token
and can only read and search files; shell commands, file edits, web access,
subagents, and repository hooks are disabled. A separate publishing job receives
only the structured review text and the repository-scoped `GITHUB_TOKEN`, never
the OpenRouter credential.

Reviews are pinned to OpenRouter model `z-ai/glm-5.3` at the `max` effort level.
Changing either setting is a versioned shared-workflow change rather than a
per-repository input.

The reviewer has a 120-turn budget and a 60-minute timeout. It reserves turns for
the final structured review and must disclose any unreviewed scope. The previous
20-turn cap was insufficient for larger cross-platform PRs and caused the publish
job to be skipped. A fresh PR event using the new workflow pin is required to test
an upgrade; rerunning an old check reuses its old workflow revision.

### Use it from a project

Create `.github/workflows/openrouter-pr-review.yml` in the consuming repository:

```yaml
name: OpenRouter PR Review

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
    uses: midan888/workflows/.github/workflows/openrouter-pr-review.yml@v4.0.0
    with:
      review_instructions: >-
        Follow AGENTS.md. Prioritize user-visible regressions and violations of
        documented cross-platform invariants.
    secrets:
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

Pin production callers to a release tag or full commit SHA, not `main`. Create
an API key in OpenRouter, give it an appropriate credit limit, and store it as
the `OPENROUTER_API_KEY` Actions secret in each repository or as an organization
secret restricted to intended repositories. Never commit or print the key.
Rotate it by creating a replacement, updating the secret, smoke-testing a review,
and deleting the old key.

For security, fork pull requests are deliberately skipped: GitHub does not
provide repository secrets to ordinary fork PR workflows, and using
`pull_request_target` would expose the API key while reviewing untrusted
code. The official action also limits execution to repository writers by default
and blocks bot actors unless explicitly allowed. This workflow does not weaken
either restriction.

### Inputs

| Input | Type | Default | Purpose |
|---|---|---|---|
| `review_instructions` | string | Empty | Adds trusted repository-specific guidance |

The required `OPENROUTER_API_KEY` secret is available only to the read-only
review job. The workflow supports `pull_request` callers only and updates the
same comment after each new PR commit instead of creating comment spam.

## Manual OpenRouter security audit

`openrouter-security-audit.yml` scans the repository's default-branch snapshot
using `anthropic/claude-fable-5.1` at max effort through OpenRouter. It reuses the
PR reviewer's `OPENROUTER_API_KEY`; the PR reviewer remains on GLM 5.3.
It opens one **draft, spec-only pull request per distinct vulnerability**, with the
report in `specs/security/SEC-<fingerprint>.md`. It does not implement fixes.

The scan has a 160-turn budget and a 60-minute timeout, with explicit instructions
to reserve turns for its structured output. An initial real scan needed 80 turns,
which exceeded the original 60-turn cap even though the model returned success.
The Claude Code outer structured-output schema deliberately contains only one
string field, `report_json`. Fable serializes the complete audit object into that
field, and the isolated publisher parses and validates the inner object before any
GitHub write. This avoids a Claude Code failure mode where complex schemas with a
narrative string plus a nested findings array can finish successfully without
returning `structured_output`; simplifying the outer schema does not relax the
publisher's field, size, path, line, or source-snapshot validation.

Claude subscription OAuth tokens are not OpenRouter credentials. Use OpenRouter
credits or a provider API key through [BYOK](https://openrouter.ai/docs/guides/overview/auth/byok);
Claude subscriptions do not pay for this API traffic. Set an appropriate OpenRouter
credit limit before running the more expensive model. Fable 5.1 has
[model-specific retention requirements](https://platform.claude.com/docs/en/models/fable-5-1/migration-guide)
and may be unavailable under an account's data policies. Do not relax those policies
automatically to make a scan run. Provider access and end-to-end behavior must be
verified on the next operator-triggered scan; existing runs keep their old model.

```yaml
name: OpenRouter Security Audit
on:
  workflow_dispatch:
    inputs:
      minimum_severity:
        type: choice
        options: [low, medium, high, critical]
        default: medium
      max_findings:
        type: number
        default: 5
permissions:
  contents: write
  pull-requests: write
jobs:
  audit:
    uses: midan888/workflows/.github/workflows/openrouter-security-audit.yml@FULL_COMMIT_SHA
    with:
      minimum_severity: ${{ inputs.minimum_severity }}
      max_findings: ${{ fromJSON(format('{0}', inputs.max_findings)) }}
      audit_instructions: >-
        Prioritize authorization, privacy, and CI credential boundaries.
    secrets:
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

Replace `FULL_COMMIT_SHA` with the published shared-workflow commit. Merge the
caller into the consuming repository's default branch, then use **Actions →
OpenRouter Security Audit → Run workflow**, selecting that branch. Other events
and branches are rejected. There is no schedule or automatic scan on pushes.

| Input | Default | Purpose |
|---|---|---|
| `audit_instructions` | Empty | Additional trusted project guidance |
| `minimum_severity` | `medium` | `low`, `medium`, `high`, or `critical` |
| `max_findings` | `5` | Maximum finding PRs, integer 1–12 |

The scanner has a read-only GitHub token and file-reading/searching tools only.
Repository settings, hooks, shell, writes, and MCP tools are disabled. A separate
publisher job has no checkout or OpenRouter key; it validates structured output
and source references, then creates single-file commits through the GitHub API.
The finding spec records severity, CWE, evidence at the audited commit, attacker
preconditions, impact, safe reproduction steps, proposed remediation, and acceptance
checks. Reproduction is proposed, not executed. Treat every finding as a draft
requiring human confirmation. The run summary states coverage and limitations;
zero findings does not certify the repository as secure.

Findings are fingerprinted by source path, CWE, and code symbol. Repeated root
causes are skipped, including those with closed or merged PRs. This avoids reopening
triaged findings, but renamed symbols/files or inconsistent model classification
can still produce duplicates; later regressions of a previously reported identity
need human triage. Existing finding branches from an interrupted run are reused
only if their diff adds exactly the expected spec file. They are never overwritten.
Separate reports under `specs/security/` avoid numbering conflicts with top-level
feature specs; promote confirmed remediation to your project's usual lifecycle.

Repository setup:

- Reuse the `OPENROUTER_API_KEY` Actions secret. No additional provider credential.
- Enable **Settings → Actions → General → Workflow permissions → Allow GitHub
  Actions to create and approve pull requests**. The audit does not approve PRs.
- The publisher needs `contents: write` and `pull-requests: write`; branch rules
  must permit `codex/security-*`. It never writes to the default branch.
- PRs created with `GITHUB_TOKEN` do not automatically run other Actions workflows.
  Validate the spec manually before merging or explicitly trigger your checks.
- Finding PRs inherit repository visibility: in public repositories, vulnerability
  details are public. Use a private repository if findings require private triage.

Maintainer checks: `node --test tests/security-audit.test.cjs` exercises the exact
inline publisher with mocked GitHub APIs; run actionlint on the reusable workflow
and each caller. An actual OpenRouter run is still needed to verify provider access
and model behavior for a consuming repository.

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
    uses: midan888/workflows/.github/workflows/weekly-codebase-audit.lock.yml@v2.1.1
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
