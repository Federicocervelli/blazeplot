/**
 * Icons for node renderers: SVG path data drawn on a canvas, the way icon sets such as Lucide draw
 * them (24-unit view box, round strokes), so nodes get icons without any HTML.
 */

/** Options for {@link createGraphIcon}. */
export interface GraphIconOptions {
  /** The icon's coordinate size: the `viewBox` width and height. Defaults to 24. */
  readonly viewBox?: number;
  /** Stroke the paths (outline icons, the default) or fill them. */
  readonly mode?: "stroke" | "fill";
  /** Stroke width in view-box units. Defaults to 2. */
  readonly strokeWidth?: number;
}

/** Draws an icon at `x`, `y` (top-left), `size` units square, in `color`, on the current transform. */
export type GraphIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) => void;

/**
 * Build an icon from SVG path data (`d` attributes). Paths are parsed once, the first time the icon is
 * drawn. Circles, lines, and rectangles from an icon set can be written as paths
 * (`"M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20"` is a circle of radius 10 around 12, 12).
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export function createGraphIcon(paths: readonly string[], options: GraphIconOptions = {}): GraphIcon {
  const viewBox = options.viewBox ?? 24;
  const fill = options.mode === "fill";
  const strokeWidth = options.strokeWidth ?? 2;
  let parsed: Path2D[] | null = null;
  return (ctx, x, y, size, color) => {
    if (typeof Path2D === "undefined" || !(size > 0)) return;
    parsed ??= paths.map((d) => new Path2D(d));
    const scale = size / viewBox;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    if (fill) {
      ctx.fillStyle = color;
      for (const path of parsed) ctx.fill(path);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const path of parsed) ctx.stroke(path);
    }
    ctx.restore();
  };
}
