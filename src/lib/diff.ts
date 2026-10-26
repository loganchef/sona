/**
 * The one-word correction between what was recognised and what the user meant.
 *
 * We learn from our own history entry instead of watching another application's
 * text box: that would need Accessibility permissions and could read things we
 * have no business reading.
 */

export interface Correction {
  term: string;
  alias: string;
}

const MAX_TOKEN = 40;
const LATIN = /^[\x20-\x7e]+$/;

export function changedPair(raw: string, text: string): Correction | null {
  if (!raw || !text || raw === text) return null;

  const a = [...raw];
  const b = [...text];

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  // Grow the span back to word boundaries: `get` → `git` must not be reported as
  // the single character `e` → `i`, which would poison the dictionary.
  while (prefix > 0 && isWordChar(a[prefix - 1]) && isWordChar(b[prefix - 1])) prefix -= 1;

  let endA = a.length - suffix;
  let endB = b.length - suffix;
  while (endA < a.length && endB < b.length && isWordChar(a[endA]) && isWordChar(b[endB])) {
    endA += 1;
    endB += 1;
  }

  const alias = a.slice(prefix, endA).join('').trim();
  const term = b.slice(prefix, endB).join('').trim();

  if (!alias || !term) return null;
  if (alias.length > MAX_TOKEN || term.length > MAX_TOKEN) return null;
  if (/\n/.test(alias) || /\n/.test(term)) return null;

  // A single Latin letter is almost always a typo inside a word, not a term.
  if (LATIN.test(alias) && LATIN.test(term) && (alias.length < 2 || term.length < 2)) return null;

  return { alias, term };
}

function isWordChar(char: string | undefined): boolean {
  if (!char) return false;
  return /[A-Za-z0-9]/.test(char) || /['’-]/.test(char);
}
