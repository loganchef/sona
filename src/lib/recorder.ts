export interface RecordedAudio {
  base64: string;
  mime: string;
  durationMs: number;
  /** Milliseconds that actually carried voice, measured by the VAD below. */
  voicedMs: number;
}

/**
 * Voice detector thresholds.
 *
 * A frame at or above `SPEECH_RMS` counts as speech; noise suppression on a
 * quiet room sits far below it. Three consecutive loud frames are required
 * before we believe speech started, so a door slam does not start the clock.
 */
const SPEECH_RMS = 0.02;
const VOICE_RMS = 0.012;
const VAD_TICK_MS = 50;
const MIN_SPEECH_BLOCKS = 3;
const NO_SPEECH_CANCEL_MS = 10_000;
/** Ten minutes is one dictation; past that the take is split by the user. */
export const MAX_TAKE_MS = 10 * 60_000;

export interface StartRecordingOptions {
  /** Silence that ends the recording; 0 keeps it manual. */
  silenceMs?: number;
  /** Fired once, when the detector ends the take by itself. */
  onAutoStop?: (reason: 'silence' | 'nospeech' | 'maxtime') => void;
  /**
   * Capture an existing stream instead of the microphone.
   *
   * Used by tests and by hosts that already hold a stream; the caller keeps
   * ownership, so we never stop its tracks.
   */
  stream?: MediaStream;
}

export interface Recording {
  /** Stop and get the encoded blob. */
  stop: () => Promise<RecordedAudio>;
  /** Stop and throw the audio away (Esc). */
  cancel: () => void;
  /** 0…1 microphone level, for the waveform. */
  level: () => number;
  /** Raw RMS of the most recent frame, 0…1. */
  rms: () => number;
  voicedMs: () => number;
  /** Everything captured so far, still recording — the live preview needs it. */
  snapshot: () => Promise<{ base64: string; mime: string } | null>;
  startedAt: number;
  mime: string;
}

const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

/** Safari/WKWebView has no webm encoder, Chromium has no mp4 one. */
function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/**
 * Map a `getUserMedia` failure to a code the UI can translate.
 *
 * WebKit reports several different things here; passing the raw DOMException
 * message through would put English platform jargon in front of the user.
 */
function microphoneFailure(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'microphone_denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'microphone_missing';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'microphone_busy';
    default:
      return 'microphone_unavailable';
  }
}

/**
 * Open the microphone, preferring voice processing.
 *
 * WKWebView (the macOS desktop shell) rejects the three processing flags with
 * "Invalid constraint" even though a plain audio stream works. Retrying without
 * them is the difference between a usable button and a dead one; only a real
 * failure after that is worth showing to the user.
 */
async function openMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    const rejectedConstraints =
      (cause instanceof DOMException &&
        (cause.name === 'OverconstrainedError' || /constraint/i.test(message))) ||
      /constraint/i.test(message);

    if (!rejectedConstraints) throw new Error(microphoneFailure(cause));

    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (fallback) {
      throw new Error(microphoneFailure(fallback));
    }
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * One recording session. Audio never touches the filesystem: it is encoded in
 * memory and handed to the Rust pipeline as base64, which behaves identically
 * on macOS, Windows, Linux, Android and iOS.
 */
export async function startRecording(options: StartRecordingOptions = {}): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('microphone_unavailable');
  }

  const external = options.stream;
  const stream = external ?? (await openMicrophone());

  const mime = pickMimeType();
  // 48 kbps opus keeps ten minutes of speech around 3.5 MB — far below every
  // provider's upload cap, and indistinguishable for speech.
  const recorder = mime
    ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48_000 })
    : new MediaRecorder(stream, { audioBitsPerSecond: 48_000 });
  const chunks: BlobPart[] = [];
  const startedAt = Date.now();

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  // Level metering is best effort: a missing AudioContext must not break capture.
  let analyser: AnalyserNode | null = null;
  let audioContext: AudioContext | null = null;
  let sampleBuffer: Uint8Array<ArrayBuffer> | null = null;

  try {
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    sampleBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
  } catch {
    analyser = null;
  }

  let voicedMs = 0;
  let lastRms = 0;
  let vadTimer = 0;
  let speechBlocks = 0;
  let speechDetected = false;
  let decided = false;
  let lastSpeechAt = Date.now();

  const readRms = (): number => {
    if (!analyser || !sampleBuffer) return 0;
    analyser.getByteTimeDomainData(sampleBuffer);
    let sum = 0;
    for (const value of sampleBuffer) {
      const centred = (value - 128) / 128;
      sum += centred * centred;
    }
    return Math.min(1, Math.sqrt(sum / sampleBuffer.length));
  };

  const stopTracks = () => {
    window.clearInterval(vadTimer);
    vadTimer = 0;
    if (!external) stream.getTracks().forEach((track) => track.stop());
    void audioContext?.close().catch(() => undefined);
  };

  // Dev-only probes: let a headless browser test see what the detector sees.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__sonaVad = () => ({
      rms: lastRms,
      voicedMs,
      speechBlocks,
      speechDetected,
      decided,
      hasAnalyser: Boolean(analyser),
    });
  }

  if (analyser) {
    const silenceMs = Math.max(300, options.silenceMs ?? 1200);
    const silenceEnabled = options.silenceMs !== 0;

    vadTimer = window.setInterval(() => {
      const rms = readRms();
      lastRms = rms;

      if (rms >= VOICE_RMS) voicedMs += VAD_TICK_MS;

      if (rms >= SPEECH_RMS) {
        speechBlocks += 1;
        if (speechBlocks >= MIN_SPEECH_BLOCKS) {
          speechDetected = true;
          lastSpeechAt = Date.now();
        }
      } else {
        speechBlocks = 0;
      }

      if (decided) return;

      // A take that never ends is a stuck key, not a long thought.
      if (Date.now() - startedAt >= MAX_TAKE_MS) {
        decided = true;
        options.onAutoStop?.('maxtime');
        return;
      }

      if (!silenceEnabled) return;

      if (speechDetected && Date.now() - lastSpeechAt >= silenceMs) {
        decided = true;
        options.onAutoStop?.('silence');
      } else if (!speechDetected && Date.now() - startedAt >= NO_SPEECH_CANCEL_MS) {
        decided = true;
        options.onAutoStop?.('nospeech');
      }
    }, VAD_TICK_MS);
  }

  recorder.start(100);

  return {
    startedAt,
    mime: recorder.mimeType || mime || 'audio/webm',
    level: () => {
      const rms = readRms();
      lastRms = rms;
      return Math.min(1, rms * 6);
    },
    rms: () => lastRms,
    voicedMs: () => voicedMs,
    snapshot: async () => {
      if (recorder.state !== 'recording' || chunks.length === 0) return null;

      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        recorder.addEventListener('dataavailable', done, { once: true });
        try {
          recorder.requestData();
        } catch {
          done();
          return;
        }
        window.setTimeout(done, 150);
      });

      if (chunks.length === 0) return null;

      const type = recorder.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunks, { type });
      return { base64: await blobToBase64(blob), mime: type.split(';')[0] };
    },
    stop: () =>
      new Promise<RecordedAudio>((resolve, reject) => {
        const finish = async () => {
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
            if (blob.size === 0) {
              reject(new Error('recording_empty'));
              return;
            }
            const base64 = await blobToBase64(blob);
            resolve({
              base64,
              mime: (recorder.mimeType || mime || 'audio/webm').split(';')[0],
              durationMs: Date.now() - startedAt,
              voicedMs,
            });
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          } finally {
            stopTracks();
          }
        };

        if (recorder.state === 'inactive') {
          void finish();
        } else {
          recorder.addEventListener('stop', () => void finish(), { once: true });
          recorder.stop();
        }
      }),
    cancel: () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // Already stopped.
      }
      chunks.length = 0;
      stopTracks();
    },
  };
}

// Dev-only handle so a headless browser can drive the recorder with a synthetic
// stream; production builds drop the whole block.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__sonaRecorder = startRecording;
}
