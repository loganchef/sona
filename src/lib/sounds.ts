/**
 * Two short blips: one when the microphone opens, one when it closes.
 *
 * Synthesised instead of shipped as audio files — no assets to load, no latency,
 * and the same three cues on every platform. Volume is deliberately low: this is
 * a confirmation, not a notification.
 */
export type Cue = 'start' | 'stop' | 'error';

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function blip(ctx: AudioContext, from: number, to: number, duration: number, gainValue: number) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, now);
  osc.frequency.exponentialRampToValueAtTime(to, now + duration);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export function playCue(cue: Cue) {
  const ctx = audio();
  if (!ctx) return;

  if (cue === 'start') {
    blip(ctx, 660, 880, 0.09, 0.05);
  } else if (cue === 'stop') {
    blip(ctx, 880, 620, 0.11, 0.045);
  } else {
    blip(ctx, 330, 240, 0.16, 0.05);
  }
}
