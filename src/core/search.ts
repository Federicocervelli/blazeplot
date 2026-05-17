export function lowerBound(length: number, valueAt: (index: number) => number, value: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (valueAt(mid) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function upperBound(length: number, valueAt: (index: number) => number, value: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (valueAt(mid) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
