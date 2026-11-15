import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { STOCK_LFS_PRE_PUSH } from '../../../scripts/git-lfs-pre-push.mjs';

const script = fileURLToPath(new URL('../../../scripts/check-main-freshness.sh', import.meta.url));
const installer = fileURLToPath(new URL('../../../scripts/install-repository-guards.mjs', import.meta.url));

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'radiohub-main-guard-test-'));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_TERMINAL_PROMPT: '0' };
  const run = (cwd: string, command: string, args: string[]) => spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 30000 });
  const git = (cwd: string, ...args: string[]) => {
    const result = run(cwd, 'git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const origin = path.join(root, 'origin.git'), writer = path.join(root, 'writer'), branch = path.join(root, 'branch');
  git(root, 'init', '--bare', '--initial-branch=main', origin);
  git(root, 'clone', origin, writer);
  const advance = (filename: string) => {
    writeFileSync(path.join(writer, filename), filename);
    git(writer, 'add', filename); git(writer, 'commit', '-m', filename); git(writer, 'push', 'origin', 'main');
  };
  advance('initial.txt');
  git(root, 'clone', origin, branch);
  git(branch, 'checkout', '-b', 'codex/fixture');
  return { root, branch, writer, env, run, git, advance,
    check: () => run(branch, '/bin/sh', [script]),
    install: () => run(branch, process.execPath, [installer]),
    close: () => rmSync(root, { recursive: true, force: true }) };
}

test('fresh and ahead branches pass without changing staged or working content', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.branch, 'staged.txt'), 'staged');
    f.git(f.branch, 'add', 'staged.txt');
    writeFileSync(path.join(f.branch, 'untracked.txt'), 'retained');
    const status = f.git(f.branch, 'status', '--porcelain'), head = f.git(f.branch, 'rev-parse', 'HEAD');
    assert.equal(f.check().status, 0);
    assert.equal(f.git(f.branch, 'status', '--porcelain'), status);
    assert.equal(f.git(f.branch, 'rev-parse', 'HEAD'), head);
    f.git(f.branch, 'commit', '-m', 'Local work');
    assert.equal(f.check().status, 0);
  } finally { f.close(); }
});

test('a newly pushed main commit is fetched, blocks stale work and never resets or stashes it', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.branch, 'local.txt'), 'Do not discard');
    f.git(f.branch, 'add', 'local.txt');
    const status = f.git(f.branch, 'status', '--porcelain'), head = f.git(f.branch, 'rev-parse', 'HEAD');
    f.advance('new-main.txt');
    const checked = f.check();
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /new main commits are missing/);
    assert.equal(f.git(f.branch, 'rev-parse', 'origin/main'), f.git(f.writer, 'rev-parse', 'HEAD'));
    assert.equal(f.git(f.branch, 'rev-parse', 'HEAD'), head);
    assert.equal(f.git(f.branch, 'status', '--porcelain'), status);
    assert.equal(readFileSync(path.join(f.branch, 'local.txt'), 'utf8'), 'Do not discard');
    f.git(f.branch, 'merge', '--ff-only', 'origin/main');
    assert.equal(f.check().status, 0);
    assert.equal(readFileSync(path.join(f.branch, 'local.txt'), 'utf8'), 'Do not discard');
  } finally { f.close(); }
});

test('an unavailable remote fails closed instead of trusting cached origin/main', () => {
  const f = fixture();
  try {
    f.git(f.branch, 'remote', 'set-url', 'origin', path.join(f.root, 'missing.git'));
    const result = f.check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Main could not be verified/);
  } finally { f.close(); }
});

test('installed Git hooks block stale commits and pushes without preventing a merge of latest main', () => {
  const f = fixture();
  try {
    assert.equal(f.install().status, 0);
    assert.equal(f.install().status, 0);
    writeFileSync(path.join(f.branch, 'feature.txt'), 'Feature');
    f.git(f.branch, 'add', 'feature.txt'); f.git(f.branch, 'commit', '-m', 'Feature');
    f.advance('new-main.txt');
    writeFileSync(path.join(f.branch, 'pending.txt'), 'Pending'); f.git(f.branch, 'add', 'pending.txt');
    const head = f.git(f.branch, 'rev-parse', 'HEAD');
    const rejected = f.run(f.branch, 'git', ['commit', '-m', 'Must stop']);
    assert.equal(rejected.status, 1);
    assert.equal(f.git(f.branch, 'rev-parse', 'HEAD'), head);
    assert.match(f.git(f.branch, 'status', '--porcelain'), /A  pending.txt/);
    // Preserve the staged file outside this test merge's commit.
    f.git(f.branch, 'restore', '--staged', 'pending.txt');
    f.git(f.branch, 'merge', '--no-ff', '--no-edit', 'origin/main');
    f.git(f.branch, 'add', 'pending.txt'); f.git(f.branch, 'commit', '-m', 'Retained work');
    assert.equal(f.check().status, 0);
    f.git(f.branch, 'push', 'origin', 'HEAD:refs/heads/feature');
    const pushed = f.git(f.branch, 'rev-parse', 'origin/feature');
    f.advance('newer-main.txt');
    const rejectedPush = f.run(f.branch, 'git', ['push', 'origin', 'HEAD:refs/heads/feature']);
    // An unchanged ref has nothing to send and Git does not invoke pre-push for it.
    assert.equal(rejectedPush.status, 0);
    f.git(f.branch, 'branch', 'stale', pushed);
    assert.equal(f.check().status, 1);
    f.git(f.branch, 'merge', '--no-ff', '--no-commit', 'origin/main');
    f.git(f.branch, 'commit', '--no-edit');
    assert.equal(f.check().status, 0);
    const otherBranchPush = f.run(f.branch, 'git', ['push', 'origin', 'stale:refs/heads/stale']);
    assert.notEqual(otherBranchPush.status, 0);
    assert.match(otherBranchPush.stderr, /new main commits are missing/);
  } finally { f.close(); }
});

test('standard LFS hook is retained and receives the original arguments/input only after freshness succeeds', () => {
  const f = fixture();
  try {
    const hooks = path.join(f.branch, '.git', 'hooks'), bin = path.join(f.root, 'bin');
    mkdirSync(bin);
    const log = path.join(f.root, 'lfs-input');
    const stub = path.join(bin, 'git-lfs');
    writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "$@" >"$LFS_TEST_LOG"\ncat >>"$LFS_TEST_LOG"\n');
    chmodSync(stub, 0o755);
    f.env.PATH = bin + path.delimiter + process.env.PATH;
    f.env.LFS_TEST_LOG = log;
    writeFileSync(path.join(hooks, 'pre-push'), STOCK_LFS_PRE_PUSH);
    assert.equal(f.install().status, 0);
    assert.equal(f.install().status, 0);
    assert.equal(readFileSync(path.join(hooks, 'radiohub-pre-push.lfs'), 'utf8'), STOCK_LFS_PRE_PUSH);
    f.git(f.branch, 'push', 'origin', 'HEAD:refs/heads/lfs-fixture');
    const input = readFileSync(log, 'utf8');
    assert.match(input, /pre-push\norigin\n/);
    assert.match(input, /HEAD [0-9a-f]{40} refs\/heads\/lfs-fixture 0{40}/);
    f.advance('later-main.txt');
    const rejected = f.run(f.branch, 'git', ['push', 'origin', 'HEAD:refs/heads/stale-lfs']);
    assert.notEqual(rejected.status, 0);
    assert.equal(readFileSync(log, 'utf8'), input, 'a rejected push must not start LFS uploads');
  } finally { f.close(); }
});

test('installation never replaces custom hooks or a configured hooksPath, even partially', () => {
  const f = fixture();
  try {
    const hooks = path.join(f.branch, '.git', 'hooks');
    writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho Existing guard\n');
    const before = readFileSync(path.join(hooks, 'pre-commit'), 'utf8');
    assert.notEqual(f.install().status, 0);
    assert.equal(readFileSync(path.join(hooks, 'pre-commit'), 'utf8'), before);
    assert.throws(() => readFileSync(path.join(hooks, 'radiohub-check-main.sh')));
    f.git(f.branch, 'config', 'core.hooksPath', 'custom-hooks');
    mkdirSync(path.join(f.branch, 'custom-hooks'));
    assert.notEqual(f.install().status, 0);
    assert.equal(f.git(f.branch, 'config', '--get', 'core.hooksPath'), 'custom-hooks');
  } finally { f.close(); }
});

test('an explicitly empty hooksPath is also preserved and cannot produce a false installation success', () => {
  const f = fixture();
  try {
    f.git(f.branch, 'config', 'core.hooksPath', '');
    const result = f.install();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /existing hooksPath/);
    assert.equal(f.git(f.branch, 'config', '--get', 'core.hooksPath'), '');
    assert.throws(() => readFileSync(path.join(f.branch, '.git', 'hooks', 'radiohub-check-main.sh')));
    assert.throws(() => readFileSync(path.join(f.branch, '.git', 'hooks', 'pre-commit')));
  } finally { f.close(); }
});
