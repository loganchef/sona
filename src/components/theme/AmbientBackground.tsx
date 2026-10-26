/**
 * Canvas.
 *
 * A near-neutral ground with a whisper of contrast: enough for the glass
 * surface to have something to sit on, quiet enough that the panels and the
 * waveform are the only things with weight.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="canvas-wash" />
      <div className="canvas-dots" />
    </div>
  );
}
