const SAMPLE_INTERVAL_MS = 66;
const SPEAKING_THRESHOLD = 0.06;

/** Whether a 0–1 level from the meter means the microphone is picking up sound. */
export function isSpeaking(level: number): boolean {
  return level > SPEAKING_THRESHOLD;
}

export interface AudioLevelMeter {
  /** Releases the audio context. */
  close(): void;
}

type AudioContextConstructor = new () => AudioContext;

function audioContextClass(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { AudioContext?: AudioContextConstructor }).AudioContext;
  return typeof candidate === "function" ? candidate : null;
}

/**
 * Samples the loudness of `stream` about 15 times a second and reports a 0–1 level. Returns `null` where Web Audio
 * isn't available; the indicator then stays idle.
 */
export function createAudioLevelMeter(stream: MediaStream, onLevel: (level: number) => void): AudioLevelMeter | null {
  const Context = audioContextClass();
  if (!Context) return null;
  let context: AudioContext;
  try {
    context = new Context();
  } catch {
    return null;
  }
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const centred = (sample - 128) / 128;
      sum += centred * centred;
    }
    onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 2));
  }, SAMPLE_INTERVAL_MS);
  return {
    close() {
      clearInterval(timer);
      source.disconnect();
      void context.close().catch(() => {});
    },
  };
}