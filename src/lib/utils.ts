import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Light haptic feedback on devices that support the Vibration API. */
export function haptic(duration = 10) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(duration);
    }
  } catch {
    // Unsupported environment: silently ignore.
  }
}

/** Clipboard helper with a fallback for restricted WebViews. */
export async function copyToClipboard(value: string | number | null | undefined) {
  if (value === undefined || value === null) return false;
  const text = String(value);

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy approach.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export function formatDate(value: string | undefined, language: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/** First characters of a title, used for avatar marks. */
export function initials(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function normalizeTags(tags: string[] | undefined) {
  const result: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim().replace(/^#/, '').trim();
    if (!tag) continue;
    if (!result.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      result.push(tag.slice(0, 24));
    }
    if (result.length >= 8) break;
  }
  return result;
}