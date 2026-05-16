import type { Camera2D } from "./Camera2D.js";

export class AxisController {
  constructor(private readonly camera: Camera2D) {}

  getXTickValues(canvasWidth: number, maxTicks: number = 10, target: number[] = []): number[] {
    return this.getTickValues(this.camera.xMin, this.camera.xMax, canvasWidth, maxTicks, 80, target);
  }

  getYTickValues(canvasHeight: number, maxTicks: number = 10, target: number[] = []): number[] {
    return this.getTickValues(this.camera.yMin, this.camera.yMax, canvasHeight, maxTicks, 48, target);
  }

  formatValue(value: number): string {
    if (Math.abs(value) < 1e-12) return "0";
    const abs = Math.abs(value);
    if (abs >= 1e6 || abs < 1e-3) return value.toExponential(2);
    if (abs >= 100) return value.toFixed(0);
    if (abs >= 10) return value.toFixed(1);
    return value.toFixed(2);
  }

  private getTickValues(min: number, max: number, pixelSize: number, maxTicks: number, minPixelSpacing: number, target: number[]): number[] {
    target.length = 0;
    if (pixelSize <= 0 || maxTicks <= 0) return target;

    const range = max - min;
    if (!Number.isFinite(range) || range <= 0) return target;

    const targetTicks = Math.max(2, Math.min(maxTicks, Math.floor(pixelSize / minPixelSpacing)));
    const step = this.niceStep(range / (targetTicks - 1));
    const firstIndex = Math.floor(min / step);
    const lastIndex = Math.ceil(max / step);

    for (let index = firstIndex; index <= lastIndex && target.length < maxTicks + 2; index++) {
      target.push(this.normalizeTick(index * step, step));
    }

    return target;
  }

  private niceStep(rawStep: number): number {
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalized = rawStep / magnitude;

    if (normalized <= 1.5) return magnitude;
    if (normalized <= 3) return 2 * magnitude;
    if (normalized <= 7) return 5 * magnitude;
    return 10 * magnitude;
  }

  private normalizeTick(value: number, step: number): number {
    const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2);
    const normalized = Number(value.toFixed(decimals));
    return Object.is(normalized, -0) ? 0 : normalized;
  }
}
