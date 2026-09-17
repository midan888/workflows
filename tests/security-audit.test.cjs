const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Test the exact inline code GitHub executes; the publisher never loads caller code.
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/openrouter-security-audit.yml'), 'utf8');
const source = workflow.split('// SECURITY_AUDIT_PUBLISHER_START (executed directly by contract tests)\n')[1]
  .split('            // SECURITY_AUDIT_PUBLISHER_END')[0].replace(/^            /gm, '');
const execute = new (Object.getPrototypeOf(async function () {}).constructor)(
  'require', 'github', 'context', 'core', 'process', source,
);
const finding = (overrides = {}) => ({
  title: 'Missing resource ownership check', severity: 'high', cwe: 'CWE-862',
  path: 'backend/auth.go', symbol: 'GetResource', start_line: 2, end_line: 5,
  evidence: 'The handler accepts an attacker-controlled resource ID without checking ownership.',
  impact: 'An authenticated user can read another user’s private records.',
  reproduction: 'Use two local test accounts and request the other account’s resource.',
  remediation: 'Scope the lookup by the authenticated user ID.',
  acceptance: ['Cross-account requests return 404.', 'The owner can still read the record.'],
  ...overrides,
});
function harness(findings = [], options = {}) {
  const calls = [];
  const seen = new Set();
  const branches = new Set();
  const context = { repo: { owner: 'acme', repo: 'vpn' }, sha: 'a'.repeat(40),
    eventName: 'workflow_dispatch', ref: 'refs/heads/main',
    payload: { repository: { default_branch: 'main' } }, serverUrl: 'https://github.com', runId: 123 };
  const file = { path: 'backend/auth.go', type: 'blob', mode: '100644', sha: 'source' };
  const record = (name, response) => async args => {
    calls.push({ name, args });
    if (options.fail === name) throw Object.assign(new Error('API unavailable'), { status: 503 });
    return { data: typeof response === 'function' ? response(args) : response };
  };
  const github = { rest: {
    git: {
      getCommit: record('getCommit', { tree: { sha: 'base-tree' } }),
      getTree: record('getTree', { truncated: !!options.truncated, tree: options.files || [file] }),
      getBlob: record('getBlob', { encoding: 'base64', size: 400,
        content: Buffer.from('line\n'.repeat(100)).toString('base64') }),
      getRef: record('getRef', args => {
        if (options.existingBranch || branches.has(args.ref)) return { object: { sha: 'existing' } };
        throw Object.assign(new Error('Not Found'), { status: 404 });
      }),
      createTree: record('createTree', { sha: 'new-tree' }),
      createCommit: record('createCommit', { sha: 'new-commit' }),
      createRef: record('createRef', args => { branches.add(args.ref.replace(/^refs\//, '')); return {}; }),
    },
    pulls: {
      list: 'pulls.list',
      create: record('pulls.create', args => { seen.add(`acme:${args.head}`); return { number: 42 }; }),
    },
    repos: { compareCommitsWithBasehead: record('compare', args => ({ files: options.diff || [{
      filename: `specs/security/SEC-${args.basehead.split('security-')[1]}.md`, status: 'added',
    }] })) },
  }, paginate: async (_method, args) => {
    calls.push({ name: 'pulls.list', args });
    return options.existingPR || seen.has(args.head) ? [{ number: 7, state: 'closed' }] : [];
  } };
  const summaries = [];
  const core = { summary: { addRaw: text => { summaries.push(text); return core.summary; }, write: async () => {} } };
  const env = { AUDIT_RESULT: JSON.stringify({ coverage: 'Reviewed backend; Apple clients not inspected.', findings }),
    MAX_FINDINGS: '5', MINIMUM_SEVERITY: 'medium', ...options.env };
  return { calls, summaries, context, env,
    run: () => execute(require, github, context, core, { env }),
    writes: () => calls.filter(x => ['createTree', 'createCommit', 'createRef', 'pulls.create'].includes(x.name)),
  };
}
test('no findings writes only the honest coverage summary', async () => {
  const h = harness(); await h.run();
  assert.equal(h.calls.length, 0);
  assert.match(h.summaries[0], /Apple clients not inspected/);
  assert.match(h.summaries[0], /No qualifying findings/);
  assert.match(h.summaries[0], /Model: anthropic\/claude-fable-5\.1 via OpenRouter \(max effort\)/);
});
test('creates one separate draft PR and only one Markdown file per finding', async () => {
  const h = harness([finding(), finding({ symbol: 'DeleteResource' })]); await h.run();
  const trees = h.calls.filter(x => x.name === 'createTree');
  assert.equal(trees.length, 2);
  for (const { args } of trees) {
    assert.equal(args.base_tree, 'base-tree');
    assert.equal(args.tree.length, 1);
    assert.match(args.tree[0].path, /^specs\/security\/SEC-[0-9a-f]{20}\.md$/);
    for (const section of ['Problem', 'Evidence', 'Impact and attacker prerequisites', 'Safe reproduction',
      'Outcome', 'Non-goals', 'Open questions', 'Design', 'Acceptance criteria', 'Verification', 'Rollout', 'Log']) {
      assert.ok(args.tree[0].content.includes(`## ${section}`));
    }
    assert.match(args.tree[0].content, /status: backlog/);
    assert.match(args.tree[0].content, /were not executed/);
    assert.match(args.tree[0].content, /source audit by Claude Fable 5\.1 through OpenRouter/);
    assert.ok(args.tree[0].content.includes(`/blob/${h.context.sha}/backend/auth.go#L2-L5`));
  }
  for (const { args } of h.calls.filter(x => x.name === 'pulls.create')) {
    assert.equal(args.draft, true); assert.equal(args.base, 'main');
    assert.match(args.head, /^codex\/security-[0-9a-f]{20}$/);
  }
  for (const { args } of h.calls.filter(x => x.name === 'createCommit')) assert.deepEqual(args.parents, [h.context.sha]);
});
test('deduplicates the same root cause independent of line, title, and severity changes', async () => {
  const h = harness([finding(), finding({ title: 'Other title', start_line: 3, severity: 'critical' })]);
  await h.run(); assert.equal(h.calls.filter(x => x.name === 'pulls.create').length, 1);
  assert.match(h.calls.find(x => x.name === 'pulls.create').args.title, /critical/);
  const before = h.writes().length;
  h.env.AUDIT_RESULT = JSON.stringify({ coverage: 'Second run', findings: [finding({ title: 'New title', start_line: 4 })] });
  await h.run(); assert.equal(h.writes().length, before);
});
test('never reopens closed or merged finding PRs', async () => {
  const h = harness([finding()], { existingPR: true }); await h.run();
  assert.equal(h.writes().length, 0);
  assert.equal(h.calls.find(x => x.name === 'pulls.list').args.state, 'all');
});
test('filters severity and caps findings in severity order', async () => {
  const h = harness([finding({ severity: 'low' }), finding({ symbol: 'High' }),
    finding({ severity: 'critical', symbol: 'Critical' })], { env: { MAX_FINDINGS: '1' } });
  await h.run(); const prs = h.calls.filter(x => x.name === 'pulls.create');
  assert.equal(prs.length, 1); assert.match(prs[0].args.title, /critical/);
});
test('all below the floor is a successful no-op', async () => {
  const h = harness([finding({ severity: 'low' })]); await h.run(); assert.equal(h.calls.length, 0);
});
test('rejects all malformed findings before any writes', async () => {
  for (const bad of [null, { title: 'only a title' }, finding({ path: '../outside' }),
    finding({ path: '/etc/passwd' }), finding({ path: '.git/config' }), finding({ path: 'a\\b' }),
    finding({ path: 'specs/security/SEC-old.md' }), finding({ start_line: 0 }),
    finding({ end_line: 1 }), finding({ severity: 'urgent' }), finding({ acceptance: [] }),
    finding({ title: 'heading\ninjection' }), finding({ cwe: 'unknown' })]) {
    const h = harness([finding(), bad]); await assert.rejects(h.run()); assert.equal(h.writes().length, 0);
  }
});
test('rejects absent, corrupt, and oversized model output', async () => {
  for (const raw of ['', 'not JSON', '{}', 'null', 'x'.repeat(60001)]) {
    const h = harness([], { env: { AUDIT_RESULT: raw } });
    await assert.rejects(h.run()); assert.equal(h.writes().length, 0);
  }
});
test('validates dispatch context and input bounds even in publishing job', async () => {
  for (const env of [{ MAX_FINDINGS: '0' }, { MAX_FINDINGS: '13' }, { MAX_FINDINGS: '1.5' }, { MINIMUM_SEVERITY: 'all' }]) {
    const h = harness([], { env }); await assert.rejects(h.run());
  }
  for (const overrides of [{ eventName: 'pull_request' }, { ref: 'refs/heads/untrusted' }, { sha: 'main' }]) {
    const h = harness(); Object.assign(h.context, overrides); await assert.rejects(h.run());
  }
});
test('rejects nonexistent files, symlinks, truncated trees, and out-of-range evidence', async () => {
  for (const options of [{ files: [] }, { truncated: true },
    { files: [{ path: 'backend/auth.go', mode: '120000', type: 'blob', sha: 'link' }] }]) {
    const h = harness([finding()], options); await assert.rejects(h.run()); assert.equal(h.writes().length, 0);
  }
  const h = harness([finding(), finding({ symbol: 'bad', end_line: 101 })]);
  await assert.rejects(h.run()); assert.equal(h.writes().length, 0);
});
test('recovers branch left by interrupted publishing without overwriting it', async () => {
  const h = harness([finding()], { existingBranch: true }); await h.run();
  assert.deepEqual(h.writes().map(x => x.name), ['pulls.create']);
});
test('refuses to publish recovery branches containing unexpected changes', async () => {
  const h = harness([finding()], { existingBranch: true, diff: [{ filename: '.github/workflows/evil.yml', status: 'added' }] });
  await assert.rejects(h.run()); assert.equal(h.writes().length, 0);
});
test('API failures fail the run instead of reporting a clean audit', async () => {
  const h = harness([finding()], { fail: 'pulls.create' }); await assert.rejects(h.run(), /API unavailable/);
});
test('renders model HTML and external image markup as literal text', async () => {
  const h = harness([finding({ evidence: '<img src="https://bad.test"> ![x](https://bad.test)' })]);
  await h.run(); const body = h.calls.find(x => x.name === 'createTree').args.tree[0].content;
  assert.ok(!body.includes('<img')); assert.ok(!body.includes('![x]('));
});
test('agent CLI receives a valid complete JSON schema matching publisher findings', () => {
  const match = workflow.match(/--json-schema '([^'\n]+)'/);
  assert.ok(match, 'missing single-quoted schema argument');
  const schema = JSON.parse(match[1]);
  assert.deepEqual(schema.required, ['coverage', 'findings']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.findings.maxItems, 12);
  const item = schema.properties.findings.items;
  assert.deepEqual([...item.required].sort(), Object.keys(finding()).sort());
  assert.deepEqual(Object.keys(item.properties).sort(), Object.keys(finding()).sort());
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.properties.severity.enum, ['low', 'medium', 'high', 'critical']);
});
test('workflow enforces privilege separation and model/tool settings', () => {
  const [scan, publish] = workflow.split('\n  publish:\n');
  assert.match(scan, /contents: read/); assert.ok(!scan.includes('contents: write'));
  assert.ok(scan.includes('--model anthropic/claude-fable-5.1')); assert.ok(scan.includes('--effort max'));
  assert.ok(scan.includes('ANTHROPIC_CUSTOM_MODEL_OPTION: anthropic/claude-fable-5.1'));
  assert.ok(scan.includes('ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES: effort,xhigh_effort,max_effort,thinking,adaptive_thinking,interleaved_thinking'));
  assert.ok(scan.includes('--tools "Read,Glob,Grep"')); assert.ok(scan.includes('--strict-mcp-config'));
  assert.ok(scan.includes('--setting-sources ""')); assert.ok(scan.includes('"disableAllHooks": true'));
  assert.ok(!publish.includes('OPENROUTER_API_KEY')); assert.ok(!publish.includes('actions/checkout'));
  assert.ok(!publish.includes('run:')); assert.ok(!publish.includes('updateRef'));
  assert.ok(!workflow.includes('pull_request_target'));
  for (const line of workflow.matchAll(/uses: (.+)/g)) assert.match(line[1], /@[0-9a-f]{40}\b/);
});
