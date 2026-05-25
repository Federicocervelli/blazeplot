export function demoSignal(x: number, phase: number): number {
  const t = x / 12;
  return Math.sin(t + phase * 0.8) * 0.65 + Math.sin(t * 0.33 + phase) * 0.32 + Math.cos(t * 1.8 + phase) * 0.08;
}

export function demoOhlcValues(x: number): readonly [number, number, number, number] {
  const open = demoSignal(x - 1, 0) * 0.75;
  const close = demoSignal(x, 0) * 0.75;
  const spread = 0.12 + Math.abs(Math.sin(x * 0.19)) * 0.08;
  return [open, Math.max(open, close) + spread, Math.min(open, close) - spread, close];
}

export function lineData(count: number, phase = 0, xStart = 0, xStep = 1): { x: Float64Array; y: Float32Array } {
  const x = new Float64Array(count);
  const y = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    x[i] = xStart + i * xStep;
    y[i] = demoSignal(i, phase);
  }
  return { x, y };
}
