/**
 * yarn check:private
 *
 * Fails if any file that could be committed contains personally identifiable data
 * (see AGENTS.md). Runs as the git pre-commit hook (.githooks/pre-commit).
 *
 * Three checks:
 *  1. No value from the private local files: postcodes in config/area.json, the email in
 *     config/zoopla.json, and the streets / UPRNs / listing ids / transaction ids in data/.
 *  2. No UK postcode other than the allowed Westminster test postcodes, in any format
 *     (upper case with or without the space, or Zoopla's lower-case hyphenated slug).
 *  3. No email address other than obvious placeholders.
 */
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';
import { normalisePostcode } from '../shared/ids';
import { PROJECT_ROOT } from './node_storage';

/**
 * The ONLY postcodes allowed in committed files: the Houses of Parliament and the
 * Westminster streets next to it that the test fixtures were scraped from.
 */
export const ALLOWED_POSTCODES = ['SW1A 0AA', 'SW1P 3BU', 'SW1P 3NG', 'SW1P 3LA'];
const ALLOWED_EMAIL = /@example\.(com|org)$|^noreply@anthropic\.com$/i;

// Upper-case with optional space, or Zoopla's lower-case slug ("sw1p-3bu")
const POSTCODE_PATTERNS = [/\b([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})\b/g, /\b([a-z]{1,2}\d[a-z\d]?)-(\d[a-z]{2})\b/g];
const IMAGE_NAME = /\.(webp|png|jpe?g|gif|svg|avif)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Never scanned: these must be gitignored (checked separately) */
const PRIVATE_PATHS = ['data/', 'config/area.json', 'config/zoopla.json'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

export interface Problem {
  file: string;
  line: number;
  match: string;
  reason: string;
}

/** A denied term and how to describe it (the term itself is never printed in full). */
export interface DeniedTerm {
  term: string;
  kind: string;
}

export function findProblems(file: string, text: string, denied: DeniedTerm[]): Problem[] {
  const problems: Problem[] = [];
  const lines = text.split('\n');
  const lower = lines.map((l) => l.toLowerCase());
  lines.forEach((line, i) => {
    for (const re of POSTCODE_PATTERNS) {
      for (const m of line.matchAll(re)) {
        const pc = normalisePostcode(`${m[1]} ${m[2]}`);
        if (!ALLOWED_POSTCODES.includes(pc)) problems.push({ file, line: i + 1, match: m[0], reason: 'postcode not in the allowed Westminster list' });
      }
    }
    for (const m of line.matchAll(EMAIL)) {
      if (IMAGE_NAME.test(m[0])) continue; // e.g. "400x200@2x.webp"
      if (!ALLOWED_EMAIL.test(m[0])) problems.push({ file, line: i + 1, match: m[0], reason: 'email address' });
    }
    for (const { term, kind } of denied) {
      const at = lower[i].indexOf(term);
      if (at < 0) continue;
      // whole-word match only, so e.g. a UPRN doesn't match inside an image hash
      const before = lower[i][at - 1] ?? ' ';
      const after = lower[i][at + term.length] ?? ' ';
      if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
      problems.push({ file, line: i + 1, match: redact(term), reason: `matches a ${kind} from your private local data` });
    }
  });
  return problems;
}

const redact = (s: string) => (s.length <= 4 ? '****' : `${s.slice(0, 2)}…${s.slice(-2)}`);

function readJson<T>(rel: string): T | undefined {
  const p = path.join(PROJECT_ROOT, rel);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : undefined;
}

/** Every identifying value we can find in the private local files. */
export function loadDeniedTerms(): DeniedTerm[] {
  const out = new Map<string, string>();
  const add = (term: unknown, kind: string, minLength = 4) => {
    if (typeof term !== 'string' && typeof term !== 'number') return;
    const t = String(term).trim().toLowerCase();
    if (t.length >= minLength) out.set(t, kind);
  };
  const addPostcode = (pc: string) => {
    const n = normalisePostcode(pc);
    if (ALLOWED_POSTCODES.includes(n)) return;
    for (const v of [n, n.replace(' ', ''), n.replace(' ', '-')]) add(v, 'postcode', 5);
  };
  const addStreet = (street: string) => {
    for (const v of [street, street.replace(/\s+/g, '_'), street.replace(/\s+/g, '-')]) add(v, 'street name', 6);
  };

  const area = readJson<{ postcodes?: (string | { postcode: string })[] }>('config/area.json');
  for (const p of area?.postcodes ?? []) addPostcode(typeof p === 'string' ? p : p.postcode);
  add(readJson<{ zoopla_login_email?: string }>('config/zoopla.json')?.zoopla_login_email, 'email');

  const properties = readJson<Record<string, Record<string, string>>>('data/properties.json') ?? {};
  for (const p of Object.values(properties)) {
    if (ALLOWED_POSTCODES.includes(normalisePostcode(p.postcode ?? ''))) continue;
    addPostcode(p.postcode ?? '');
    addStreet(p.street ?? '');
    add(p.uprn, 'UPRN', 5);
  }
  for (const l of Object.values(readJson<Record<string, Record<string, string>>>('data/listings.json') ?? {})) {
    add(l.zooplaListingId, 'Zoopla listing id', 6);
  }
  for (const s of Object.values(readJson<Record<string, Record<string, string>>>('data/sales.json') ?? {})) {
    if (s.source === 'land_registry') add(s.id, 'Land Registry transaction id', 8);
  }
  return [...out].map(([term, kind]) => ({ term, kind }));
}

function isGitRepo(): boolean {
  return existsSync(path.join(PROJECT_ROOT, '.git'));
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8' });
}

/** Files that are, or could be, committed: tracked + untracked-but-not-ignored. */
function candidateFiles(): string[] {
  if (isGitRepo()) {
    return git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  }
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(path.join(PROJECT_ROOT, dir))) {
      const rel = dir ? `${dir}/${name}` : name;
      if (SKIP_DIRS.has(name) || PRIVATE_PATHS.some((p) => rel === p.replace(/\/$/, '') || rel.startsWith(p))) continue;
      if (statSync(path.join(PROJECT_ROOT, rel)).isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  walk('');
  return out;
}

function main() {
  const problems: Problem[] = [];

  // The private files must be ignored, so they can never be staged by accident.
  if (isGitRepo()) {
    for (const p of PRIVATE_PATHS) {
      try {
        git(['check-ignore', '-q', '--no-index', p]);
      } catch {
        problems.push({ file: '.gitignore', line: 0, match: p, reason: 'private path is not gitignored' });
      }
    }
  }

  const denied = loadDeniedTerms();
  const files = candidateFiles().filter((f) => f !== 'yarn.lock');
  for (const file of files) {
    if (PRIVATE_PATHS.some((p) => file === p.replace(/\/$/, '') || file.startsWith(p))) {
      problems.push({ file, line: 0, match: file, reason: 'private file would be committed' });
      continue;
    }
    const buf = readFileSync(path.join(PROJECT_ROOT, file));
    if (buf.includes(0)) {
      problems.push({ file, line: 0, match: file, reason: 'binary file (e.g. a scraped photo?) - check it by hand and add it explicitly' });
      continue;
    }
    problems.push(...findProblems(file, buf.toString('utf8'), denied));
  }

  if (problems.length) {
    console.error(`✗ Possible personal data in ${new Set(problems.map((p) => p.file)).size} file(s) - DO NOT COMMIT (see AGENTS.md):\n`);
    for (const p of problems) console.error(`  ${p.file}${p.line ? `:${p.line}` : ''}  ${p.match}  (${p.reason})`);
    process.exit(1);
  }
  console.log(`✓ No personal data found in ${files.length} files (checked against ${denied.length} private terms).`);
}

if (require.main === module) main();
