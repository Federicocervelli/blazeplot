export function demoSignal(x: number, phase: number): number {
  const t = x / 12;
  return Math.sin(t + phase * 0.8) * 0.65 + Math.sin(t * 0.33 + phase) * 0.32 + Math.cos(t * 1.8 + phase) * 0.08;
}

function demoMarketClose(x: number): number {
  const trend = x * 0.035;
  const cycle = Math.sin(x * 0.065) * 9 + Math.sin(x * 0.19) * 3.2;
  const pullback = x > 120 && x < 170 ? -(x - 120) * 0.11 : x >= 170 && x < 220 ? -5.5 + (x - 170) * 0.08 : 0;
  return 184 + trend + cycle + pullback;
}

export function demoOhlcValues(x: number): readonly [number, number, number, number] {
  const open = demoMarketClose(x - 1);
  const close = demoMarketClose(x) + Math.sin(x * 0.73) * 0.9;
  const volatility = 1.4 + Math.abs(Math.sin(x * 0.23)) * 2.2 + (x % 41 === 0 ? 4.5 : 0);
  const high = Math.max(open, close) + volatility * (0.45 + Math.abs(Math.sin(x * 0.37)) * 0.35);
  const low = Math.min(open, close) - volatility * (0.45 + Math.abs(Math.cos(x * 0.29)) * 0.35);
  return [open, high, low, close];
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
