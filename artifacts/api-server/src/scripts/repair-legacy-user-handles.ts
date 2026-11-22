import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { closePostgres } from '../postgres-runtime';
import { repairLegacyUserHandles } from '../data/legacy-user-handle-repair';

export function legacyHandleRepairOptions(args: string[]) {
  const options = { apply: false, batchSize: 100, pauseMs: 25, help: false };
  for (const arg of args) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--help') options.help = true;
    else if (/^--batch-size=\d+$/.test(arg)) options.batchSize = Number(arg.split('=')[1]);
    else if (/^--pause-ms=\d+$/.test(arg)) options.pauseMs = Number(arg.split('=')[1]);
    else throw new Error('INVALID_REPAIR_ARGUMENT');
  }
  if (options.batchSize < 1 || options.batchSize > 500 || options.pauseMs < 0 || options.pauseMs > 1000) throw new Error('INVALID_REPAIR_ARGUMENT');
  return options;
}

export async function runLegacyHandleRepair(args = process.argv.slice(2)) {
  const options = legacyHandleRepairOptions(args);
  if (options.help) {
    console.log('Usage: node dist/repair-legacy-user-handles.mjs [--dry-run|--apply] [--batch-size=100] [--pause-ms=25]');
    console.log('Defaults to a read-only scan. Apply changes only proven automatic usernames; account data and credentials are never printed.');
    return;
  }
  const summary = await repairLegacyUserHandles({ ...options, onProgress: counters => console.log(JSON.stringify({ event: 'legacy_handle_repair_progress', ...counters })) });
  if (!options.apply) { console.log(JSON.stringify({ event: 'legacy_handle_repair_complete', ...summary })); return; }
  const verification = await repairLegacyUserHandles({ apply: false, batchSize: options.batchSize });
  console.log(JSON.stringify({ event: 'legacy_handle_repair_complete', ...summary, remainingEligible: verification.eligible, remainingUnproven: verification.unproven }));
  if (verification.eligible) process.exitCode = 2;
}

function invokedDirectly() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (invokedDirectly()) {
  try { await runLegacyHandleRepair(); }
  catch { console.error('Legacy handle repair failed; no account data or credentials are printed.'); process.exitCode = 1; }
  finally { await closePostgres(); }
}
