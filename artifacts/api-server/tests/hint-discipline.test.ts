/**
 * HINT DISCIPLINE GUARD (incident 2026-05-15 v10, 4th recurrence).
 *
 * Background: a `.hint('index_name')` referencing a hidden or missing
 * Atlas index throws BadValue (code 2) and silently turns every cold
 * read into a 500. We have regressed this exact bug at least four
 * times. The fix is procedural: every `.hint(` call MUST be preceded
 * by a `// HINT-VERIFIED YYYY-MM-DD` comment proving someone probed
 * the live index set before adding it.
 *
 * This test greps the api-server source tree (excluding tests / dist)
 * for any `.hint(` call and fails the build if the comment is not
 * present in the immediately preceding 5 lines.
 *
 * Verify the index exists in the active environment before adding a hint.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const HINT_RE = /\.hint\s*\(/;
const VERIFIED_RE = /\/\/\s*HINT-VERIFIED\s+\d{4}-\d{2}-\d{2}\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full, out);
    } else if (s.isFile() && (entry.endsWith('.ts') || entry.endsWith('.mts'))) {
      out.push(full);
    }
  }
  return out;
}

describe('hint discipline (incident 2026-05-15 v10)', () => {
  it('every .hint(...) call has a HINT-VERIFIED YYYY-MM-DD comment within 5 preceding lines', () => {
    const files = walk(SRC_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!HINT_RE.test(lines[i])) continue;
        // Skip comments / matches inside strings — best-effort: ignore lines
        // whose first non-whitespace character is `//` or `*`.
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

        // Look back up to 5 lines for the marker.
        const start = Math.max(0, i - 5);
        const window = lines.slice(start, i).join('\n');
        if (!VERIFIED_RE.test(window)) {
          const rel = relative(process.cwd(), file);
          violations.push(`${rel}:${i + 1}  ${trimmed}`);
        }
      }
    }

    assert.equal(
      violations.length,
      0,
      `Found ${violations.length} unverified .hint(...) call(s). Each must be preceded by a ` +
        `\`// HINT-VERIFIED YYYY-MM-DD - <name>\` comment within the previous 5 lines ` +
        `(incident 2026-05-15 v10).\n\nViolations:\n  ${violations.join('\n  ')}`
    );
  });
});
