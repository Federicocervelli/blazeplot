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

/**
 * `lowerBound` over the first `length` entries of an array. Same result as the callback form without
 * allocating a closure, for per-pick and per-frame hot paths.
 */
export function lowerBoundTyped(values: ArrayLike<number>, length: number, value: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (values[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `upperBound` over the first `length` entries of an array; see `lowerBoundTyped`. */
export function upperBoundTyped(values: ArrayLike<number>, length: number, value: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (values[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * `lowerBound` over a ring: logical index `i` lives at physical `(start + i) % values.length`. Returns a
 * logical index in `[0, length]`.
 */
export function lowerBoundRing(values: ArrayLike<number>, start: number, length: number, value: number): number {
  const capacity = values.length;
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    let physical = start + mid;
    if (physical >= capacity) physical -= capacity;
    if (values[physical]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `upperBound` over a ring; see `lowerBoundRing`. */
export function upperBoundRing(values: ArrayLike<number>, start: number, length: number, value: number): number {
  const capacity = values.length;
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    let physical = start + mid;
    if (physical >= capacity) physical -= capacity;
    if (values[physical]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Return the first array index whose value is greater than `value`. */
export function upperBoundArray(values: readonly number[], value: number): number {
  return upperBoundTyped(values, values.length, value);
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
