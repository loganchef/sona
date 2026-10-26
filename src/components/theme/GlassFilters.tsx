/**
 * Liquid Glass displacement filters.
 *
 * Apple's Liquid Glass is clear in the middle and bends light hard at the
 * edges. A uniform `blur()` can never reproduce that — it needs a real
 * displacement map, so the backdrop is physically warped near the border.
 *
 * How it works
 * ------------
 * `feDisplacementMap` shifts each pixel by the value of two channels of a map
 * image, where 128 (0.5) means "no shift". We feed it two generated maps:
 *
 *   mapX : red ramps 0 → 128 → 255 horizontally, blue pinned at 128
 *   mapY : green ramps 0 → 128 → 255 vertically,  blue pinned at 128
 *
 * Displacing twice (X against red, Y against green, each time reading the
 * constant blue channel for the other axis) gives independent control per
 * axis. The flat 128 plateau in the middle is why the centre stays sharp.
 *
 * The filters are applied through `backdrop-filter: url(#…)`, so `SourceGraphic`
 * here is the *backdrop* behind the element, not the element itself.
 */

const EDGE = 0.2; // width of the refracting band, as a fraction of the side

const mapX = `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' preserveAspectRatio='none'><defs><linearGradient id='a' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='rgb(0,128,128)'/><stop offset='${EDGE}' stop-color='rgb(128,128,128)'/><stop offset='${1 - EDGE}' stop-color='rgb(128,128,128)'/><stop offset='1' stop-color='rgb(255,128,128)'/></linearGradient></defs><rect width='100' height='100' fill='url(%23a)'/></svg>`;

const mapY = `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' preserveAspectRatio='none'><defs><linearGradient id='b' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='rgb(128,0,128)'/><stop offset='${EDGE}' stop-color='rgb(128,128,128)'/><stop offset='${1 - EDGE}' stop-color='rgb(128,128,128)'/><stop offset='1' stop-color='rgb(128,255,128)'/></linearGradient></defs><rect width='100' height='100' fill='url(%23b)'/></svg>`;

const uri = (svg: string) => `data:image/svg+xml;utf8,${svg.replace(/#/g, '%23')}`;

interface LensProps {
  id: string;
  /** Displacement strength in pixels. */
  scale: number;
  /** Residual blur applied after warping. */
  blur: number;
}

function Lens({ id, scale, blur }: LensProps) {
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="0%" y="0%" width="100%" height="100%">
      <feImage href={uri(mapX)} preserveAspectRatio="none" x="0%" y="0%" width="100%" height="100%" result="mapX" />
      <feImage href={uri(mapY)} preserveAspectRatio="none" x="0%" y="0%" width="100%" height="100%" result="mapY" />

      {/* Horizontal bend: read red for X, the flat blue channel for Y. */}
      <feDisplacementMap
        in="SourceGraphic"
        in2="mapX"
        scale={scale}
        xChannelSelector="R"
        yChannelSelector="B"
        result="bentX"
      />
      {/* Vertical bend: flat blue for X, green for Y. */}
      <feDisplacementMap
        in="bentX"
        in2="mapY"
        scale={scale}
        xChannelSelector="B"
        yChannelSelector="G"
        result="bent"
      />

      <feGaussianBlur in="bent" stdDeviation={blur} />
    </filter>
  );
}

/** Mounted once, near the root. Renders nothing visible. */
export function GlassFilters() {
  return (
    <svg
      aria-hidden
      focusable="false"
      width="0"
      height="0"
      style={{ position: 'absolute', pointerEvents: 'none' }}
    >
      <defs>
        {/* Large surfaces: gentle bend, stays readable. */}
        <Lens id="lg-panel" scale={54} blur={1.1} />
        {/* Floating chrome: stronger lensing, it is small and sits over motion. */}
        <Lens id="lg-chrome" scale={64} blur={0.5} />
      </defs>
    </svg>
  );
}