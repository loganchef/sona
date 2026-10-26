import { useEffect, useState } from 'react';

/** Rolling microphone levels for the waveform, sampled on a fixed clock. */
export function useLevels(read: () => number, active: boolean, size = 32, intervalMs = 70) {
  const [levels, setLevels] = useState<number[]>(() => new Array(size).fill(0));

  useEffect(() => {
    if (!active) {
      setLevels(new Array(size).fill(0));
      return;
    }

    const timer = window.setInterval(() => {
      setLevels((previous) => [...previous.slice(1), read()]);
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [active, intervalMs, read, size]);

  return levels;
}
