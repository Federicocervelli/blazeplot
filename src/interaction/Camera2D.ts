import type { Viewport } from "../core/types.js";
import type { PanIntent, ZoomIntent } from "./types.js";

export class Camera2D {
  private _xMin: number = 0;
  private _xMax: number = 1;
  private _yMin: number = 0;
  private _yMax: number = 1;
  private _xReversed: boolean = false;
  private _yReversed: boolean = false;

  get xMin(): number {
    return this._xMin;
  }

  get xMax(): number {
    return this._xMax;
  }

  get yMin(): number {
    return this._yMin;
  }

  get yMax(): number {
    return this._yMax;
  }

  get xReversed(): boolean {
    return this._xReversed;
  }

  get yReversed(): boolean {
    return this._yReversed;
  }

  get viewport(): Viewport {
    return { xMin: this._xMin, xMax: this._xMax, yMin: this._yMin, yMax: this._yMax };
  }

  get xScale(): number {
    return (this._xReversed ? -2 : 2) / (this._xMax - this._xMin);
  }

  get xOffset(): number {
    const offset = -(this._xMin + this._xMax) / (this._xMax - this._xMin);
    return this._xReversed ? -offset : offset;
  }

  get yScale(): number {
    return (this._yReversed ? -2 : 2) / (this._yMax - this._yMin);
  }

  get yOffset(): number {
    const offset = -(this._yMin + this._yMax) / (this._yMax - this._yMin);
    return this._yReversed ? -offset : offset;
  }

  setReversed(v: { x?: boolean; y?: boolean }): void {
    if (v.x !== undefined) this._xReversed = v.x;
    if (v.y !== undefined) this._yReversed = v.y;
  }

  setViewport(v: { xMin?: number; xMax?: number; yMin?: number; yMax?: number }): void {
    const next = {
      xMin: v.xMin ?? this._xMin,
      xMax: v.xMax ?? this._xMax,
      yMin: v.yMin ?? this._yMin,
      yMax: v.yMax ?? this._yMax,
    };
    Camera2D.assertValidViewport(next);
    this._xMin = next.xMin;
    this._xMax = next.xMax;
    this._yMin = next.yMin;
    this._yMax = next.yMax;
  }

  pan(intent: PanIntent): void {
    const { dx, dy } = intent;
    Camera2D.assertFinite("dx", dx);
    Camera2D.assertFinite("dy", dy);
    const rangeX = this._xMax - this._xMin;
    const rangeY = this._yMax - this._yMin;
    this.setViewport({
      xMin: this._xMin + dx * rangeX,
      xMax: this._xMax + dx * rangeX,
      yMin: this._yMin + dy * rangeY,
      yMax: this._yMax + dy * rangeY,
    });
  }

  zoom(intent: ZoomIntent): void {
    const { factor, cx, cy, axis } = intent;
    Camera2D.assertFinite("factor", factor);
    Camera2D.assertFinite("cx", cx);
    Camera2D.assertFinite("cy", cy);
    if (factor <= 0) throw new RangeError("Camera2D zoom factor must be > 0.");

    const rangeX = this._xMax - this._xMin;
    const rangeY = this._yMax - this._yMin;
    const dataCx = this._xMin + rangeX * cx;
    const dataCy = this._yMin + rangeY * cy;
    const newRangeX = axis === "y" ? rangeX : rangeX / factor;
    const newRangeY = axis === "x" ? rangeY : rangeY / factor;
    this.setViewport({
      xMin: dataCx - newRangeX * cx,
      xMax: dataCx + newRangeX * (1 - cx),
      yMin: dataCy - newRangeY * cy,
      yMax: dataCy + newRangeY * (1 - cy),
    });
  }

  toClip(x: number, y: number): [number, number] {
    return [
      x * this.xScale + this.xOffset,
      y * this.yScale + this.yOffset,
    ];
  }

  toScreen(clipX: number, clipY: number, canvasWidth: number, canvasHeight: number): [number, number] {
    return [
      (clipX + 1) * 0.5 * canvasWidth,
      (1 - clipY) * 0.5 * canvasHeight,
    ];
  }

  screenToData(screenX: number, screenY: number, canvasWidth: number, canvasHeight: number): [number, number] {
    if (canvasWidth <= 0 || canvasHeight <= 0) throw new RangeError("Camera2D screen size must be positive.");
    const clipX = (screenX / canvasWidth) * 2 - 1;
    const clipY = 1 - (screenY / canvasHeight) * 2;
    return [
      Camera2D.normalizeZero((clipX - this.xOffset) / this.xScale),
      Camera2D.normalizeZero((clipY - this.yOffset) / this.yScale),
    ];
  }

  clone(): Camera2D {
    const c = new Camera2D();
    c.setViewport(this.viewport);
    c.setReversed({ x: this._xReversed, y: this._yReversed });
    return c;
  }

  private static assertValidViewport(v: Viewport): void {
    Camera2D.assertFinite("xMin", v.xMin);
    Camera2D.assertFinite("xMax", v.xMax);
    Camera2D.assertFinite("yMin", v.yMin);
    Camera2D.assertFinite("yMax", v.yMax);
    if (v.xMax <= v.xMin) throw new RangeError("Camera2D requires xMax > xMin.");
    if (v.yMax <= v.yMin) throw new RangeError("Camera2D requires yMax > yMin.");
  }

  private static assertFinite(name: string, value: number): void {
    if (!Number.isFinite(value)) throw new RangeError(`Camera2D ${name} must be finite.`);
  }

  private static normalizeZero(value: number): number {
    return Object.is(value, -0) ? 0 : value;
  }
}
