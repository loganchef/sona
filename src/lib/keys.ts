const MAC_SYMBOLS: Record<string, string> = {
  alt: '⌥',
  option: '⌥',
  ctrl: '⌃',
  control: '⌃',
  cmd: '⌘',
  command: '⌘',
  super: '⌘',
  cmdorcontrol: '⌘',
  cmdorctrl: '⌘',
  shift: '⇧',
  escape: 'Esc',
  esc: 'Esc',
  space: 'Space',
  enter: '↵',
};

const PC_LABELS: Record<string, string> = {
  alt: 'Alt',
  option: 'Alt',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  cmd: 'Win',
  command: 'Win',
  super: 'Win',
  cmdorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  shift: 'Shift',
  escape: 'Esc',
  esc: 'Esc',
  space: 'Space',
  enter: 'Enter',
};

/** Render an accelerator the way the user's OS writes it. */
export function formatAccelerator(accelerator: string, platform: string): string {
  const mac = platform === 'macos' || platform === 'ios';
  const table = mac ? MAC_SYMBOLS : PC_LABELS;

  return accelerator
    .split('+')
    .map((token) => {
      const key = token.trim().toLowerCase();
      return table[key] ?? token.trim();
    })
    .join(mac ? ' ' : ' + ');
}

export function modeLabelKey(mode: string): string {
  return `mode.${mode}`;
}

const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab']);

/**
 * Turn a real key press into an accelerator the global-shortcut layer accepts.
 *
 * Bare modifiers are rejected on purpose: registering `Control` would swallow
 * the key for every app on the machine, and the OS would refuse it anyway.
 */
export function captureAccelerator(event: KeyboardEvent): string | null {
  if (IGNORED_KEYS.has(event.key)) return null;

  const parts: string[] = [];
  if (event.metaKey) parts.push('CmdOrControl');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  if (parts.length === 0) return null;

  const key = acceleratorKey(event);
  if (!key) return null;

  parts.push(key);
  return parts.join('+');
}

function acceleratorKey(event: KeyboardEvent): string | null {
  const { key, code } = event;
  if (key === ' ') return 'Space';
  if (key === 'Escape') return 'Escape';
  if (key === 'Enter') return 'Enter';
  if (key === 'Tab') return 'Tab';
  if (key === 'Backspace' || key === 'Delete') return null;

  // Physical key for letters, so a non-Latin layout still yields `KeyD`.
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key.toUpperCase();
  if (key.length === 1 && /[A-Za-z0-9]/.test(key)) return key.toUpperCase();

  return null;
}
