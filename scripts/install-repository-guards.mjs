import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STOCK_LFS_PRE_PUSH } from './git-lfs-pre-push.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let configured;
try { configured = git('config', '--get', 'core.hooksPath'); }
catch (error) { if (error.status !== 1) throw error; }
if (configured) throw new Error('An existing hooksPath is configured. It was not changed; integrate the main guard with those hooks manually.');
const hooks = path.join(git('rev-parse', '--path-format=absolute', '--git-common-dir'), 'hooks');
const files = [
  ['scripts/check-main-freshness.sh', 'radiohub-check-main.sh'],
  ['.githooks/pre-commit', 'pre-commit'],
  ['.githooks/pre-push', 'pre-push'],
].map(([source, name]) => ({ name, content: readFileSync(path.join(root, source)), destination: path.join(hooks, name) }));
const prePush = files.find(file => file.name === 'pre-push');
const stockLfs = existsSync(prePush.destination) && readFileSync(prePush.destination, 'utf8') === STOCK_LFS_PRE_PUSH;
if (stockLfs) files.unshift({ name: 'radiohub-pre-push.lfs', content: Buffer.from(STOCK_LFS_PRE_PUSH),
  destination: path.join(hooks, 'radiohub-pre-push.lfs') });

// Validate the entire installation before creating any file; never replace hooks.
for (const file of files) {
  if (file === prePush && stockLfs) continue;
  if (existsSync(file.destination) && !readFileSync(file.destination).equals(file.content)) {
    throw new Error(`Existing ${file.name} was preserved. Integrate the main guard with it manually.`);
  }
}
mkdirSync(hooks, { recursive: true });
for (const file of files) {
  if (file === prePush && stockLfs) {
    if (readFileSync(file.destination, 'utf8') !== STOCK_LFS_PRE_PUSH) throw new Error('The LFS hook changed during installation; it was not replaced.');
    const temporary = file.destination + '.radiohub-' + process.pid;
    writeFileSync(temporary, file.content, { flag: 'wx', mode: 0o755 });
    renameSync(temporary, file.destination);
  } else if (!existsSync(file.destination)) writeFileSync(file.destination, file.content, { flag: 'wx', mode: 0o755 });
  chmodSync(file.destination, 0o755);
}
console.log('Main freshness guards installed for this repository and its linked worktrees. Custom hooks and working files were preserved.');
if (stockLfs) console.log('The stock Git LFS hook was backed up intact and chained after the main check, with the same arguments and input.');
