/**
 * Known backend error codes → translation keys.
 *
 * The Rust pipeline speaks in codes (`no_speech`, `asr_not_configured`), the UI
 * speaks in sentences; this is the only place the two meet.
 */
const KEYS: Record<string, string> = {
  no_speech: 'voice.noSpeech',
  audio_empty: 'voice.noSpeech',
  recording_empty: 'voice.noSpeech',
  asr_not_configured: 'error.asrNotConfigured',
  polish_not_configured: 'error.polishNotConfigured',
  microphone_unavailable: 'error.microphone',
  microphone_denied: 'error.microphoneDenied',
  microphone_missing: 'error.microphoneMissing',
  microphone_busy: 'error.microphoneBusy',
  max_take: 'voice.maxTake',
  autostart_set: 'settings.autostartFailed',
  autostart_state: 'settings.autostartFailed',
  style_pack_not_found: 'packs.notFound',
  style_pack_empty: 'packs.cycleEmpty',
  provider_test_browser: 'providers.testBrowserBlocked',
};

export function dictationErrorKey(code: string): string | null {
  const trimmed = code.trim();
  const direct = KEYS[trimmed];
  if (direct) return direct;

  // Rust errors arrive as `code: detail` or `code_http_401: body`.
  const head = trimmed.split(':')[0].trim();
  if (KEYS[head]) return KEYS[head];
  if (
    head.startsWith('asr_http_401') ||
    head.startsWith('asr_http_403') ||
    head.startsWith('asr_probe_http_401') ||
    head.startsWith('asr_probe_http_403') ||
    head.startsWith('polish_http_401') ||
    head.startsWith('polish_http_403') ||
    head.startsWith('polish_probe_http_401') ||
    head.startsWith('polish_probe_http_403')
  ) {
    return 'error.badKey';
  }
  if (head.startsWith('asr_probe_http_404') || head.startsWith('polish_probe_http_404')) {
    return 'error.endpoint';
  }
  if (
    head.startsWith('asr_probe') ||
    head.startsWith('polish_probe') ||
    head.startsWith('asr_client') ||
    head.startsWith('polish_client') ||
    head.startsWith('local_asr_unreachable')
  ) {
    return 'error.unreachable';
  }
  if (head.startsWith('local_asr_no_models')) return 'error.noModels';
  if (head.startsWith('local_asr_url_required')) return 'error.endpoint';
  return null;
}
