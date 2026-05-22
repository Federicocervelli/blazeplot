/** Return the first index whose value is greater than or equal to `value`. */
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

/** Return the first index whose value is greater than `value`. */
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
