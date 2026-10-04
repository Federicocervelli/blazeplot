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

/** Return the first array index whose value is greater than `value`. */
export function upperBoundArray(values: readonly number[], value: number): number {
  return upperBound(values.length, (index) => values[index]!, value);
}

/** @internal Return a function that warns once when a buffer skips or ignores a non-finite X. */
export function nonFiniteXWarning(owner: string, action: string): (x: number) => void {
  let warned = false;
  return (x) => {
    if (warned) return;
    warned = true;
    console.warn(
      `${owner} received non-finite X ${x}; ${action}. X values must be finite numbers. ` +
        "This warning is shown once per buffer.",
    );
  };
}

/** @internal Return a check that warns once when a buffer's X values stop ascending. */
export function unsortedXWarning(owner: string): (previous: number, next: number) => void {
  let warned = false;
  return (previous, next) => {
    if (warned || !(next < previous)) return;
    warned = true;
    console.warn(
      `${owner} received X ${next} after ${previous}. X values must be ascending: range queries, culling, and picking ` +
        "binary-search X, so out-of-order samples can be hidden or drawn in the wrong place. Sort data before appending.",
    );
  };
}
