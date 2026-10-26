import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { startRecording, type Recording } from '@/lib/recorder';
import type { DictationResult, OutputLanguage, PendingDictation } from '@/types';

export type DictationPhase = 'idle' | 'recording' | 'processing' | 'done' | 'error';

export interface UseDictationOptions {
  onFinished?: (result: DictationResult) => void;
  /** Receives a backend code or message; map it with `dictationErrorKey`. */
  onError?: (message: string) => void;
  outputLanguage?: OutputLanguage;
  /** End the take after a stretch of silence. */
  autoStop?: boolean;
  silenceMs?: number;
  /** Ask for a provisional transcript while recording (costs extra ASR calls). */
  livePreview?: boolean;
}

/**
 * The recording state machine shared by the hub, the capsule and mobile.
 * One implementation, three hosts.
 */
export function useDictation(options: UseDictationOptions = {}) {
  const { onFinished, onError, outputLanguage, autoStop = true, silenceMs = 1200, livePreview = false } =
    options;
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [result, setResult] = useState<DictationResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [partial, setPartial] = useState('');
  // A failed take whose audio is still in memory on the Rust side.
  const [pending, setPending] = useState<PendingDictation | null>(null);
  const recordingRef = useRef<Recording | null>(null);
  // The VAD fires from a timer inside the recorder, so it needs a stable handle
  // to the current `stop` without re-subscribing on every render.
  const stopRef = useRef<() => Promise<void>>(async () => undefined);

  const refreshPending = useCallback(async () => {
    try {
      setPending(await api.dictation.pending());
    } catch {
      // A pending probe is an optimisation, never a blocker.
    }
  }, []);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  const start = useCallback(async () => {
    if (recordingRef.current) return;
    try {
      setMessage(null);
      const recording = await startRecording({
        silenceMs: autoStop ? silenceMs : 0,
        onAutoStop: (reason) => {
          if (reason === 'silence') {
            void stopRef.current();
            return;
          }

          if (reason === 'maxtime') {
            // Keep the ten minutes we already have instead of losing them.
            setMessage('max_take');
            void stopRef.current();
            return;
          }
          // Ten seconds of nothing: drop the take instead of pasting noise.
          recordingRef.current?.cancel();
          recordingRef.current = null;
          setPhase('idle');
          setMessage('no_speech');
          onError?.('no_speech');
        },
      });
      recordingRef.current = recording;
      setPhase('recording');
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setMessage(text);
      setPhase('error');
      onError?.(text);
    }
  }, [autoStop, onError, silenceMs]);

  const stop = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;

    recordingRef.current = null;
    setPhase('processing');

    try {
      const audio = await recording.stop();
      const next = await api.dictation.run({
        audioBase64: audio.base64,
        mime: audio.mime,
        durationMs: audio.durationMs,
        voicedMs: audio.voicedMs,
        outputLanguage,
      });
      setResult(next);
      setPhase('done');
      setPending(null);
      onFinished?.(next);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setMessage(text);
      setPhase('error');
      onError?.(text);
      void refreshPending();
    }
  }, [onError, onFinished, outputLanguage, refreshPending]);

  /** Re-run the kept take without asking the user to speak again. */
  const retry = useCallback(async () => {
    setPhase('processing');
    setMessage(null);
    try {
      const next = await api.dictation.retry();
      setResult(next);
      setPhase('done');
      setPending(null);
      onFinished?.(next);
      return next;
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setMessage(text);
      setPhase('error');
      onError?.(text);
      void refreshPending();
      throw cause;
    }
  }, [onError, onFinished, refreshPending]);

  const discard = useCallback(async () => {
    try {
      await api.dictation.discard();
    } finally {
      setPending(null);
    }
  }, []);

  stopRef.current = stop;

  // Provisional text: one extra transcription every couple of seconds while the
  // user is still speaking. Never inserted, never stored — display only.
  useEffect(() => {
    if (!livePreview || phase !== 'recording') {
      setPartial('');
      return;
    }

    let cancelled = false;
    const tick = async () => {
      const snapshot = await recordingRef.current?.snapshot();
      if (!snapshot || cancelled) return;
      try {
        const text = await api.dictation.preview(snapshot.base64, snapshot.mime);
        if (!cancelled) setPartial(text);
      } catch {
        // A preview failure is silent: the real transcription still runs.
      }
    };

    const timer = window.setInterval(() => void tick(), 2600);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [livePreview, phase]);

  const cancel = useCallback(() => {
    recordingRef.current?.cancel();
    recordingRef.current = null;
    setPhase('idle');
    setMessage(null);
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setResult(null);
    setMessage(null);
  }, []);

  const level = useCallback(() => recordingRef.current?.level() ?? 0, []);

  return {
    phase,
    partial,
    result,
    message,
    start,
    stop,
    retry,
    discard,
    pending,
    refreshPending,
    cancel,
    reset,
    level,
    rms: () => recordingRef.current?.rms() ?? 0,
    voicedMs: () => recordingRef.current?.voicedMs() ?? 0,
    isBusy: phase === 'recording' || phase === 'processing',
  };
}
