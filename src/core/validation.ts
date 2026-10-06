import type { InvalidSampleReason } from "./types.js";

/**
 * @internal Lowest X a dataset accepts when it holds no samples. Every finite number is
 * `>=` it, while `-Infinity` and `NaN` are not, so `x >= floor && x <= MAX_X` is the
 * whole "finite and non-decreasing" check.
 */
export const MIN_X = -Number.MAX_VALUE;
/** @internal Highest finite X. */
export const MAX_X = Number.MAX_VALUE;

/** @internal Return why `x` fails the X rule against the previous accepted X. */
export function invalidXReason(x: number): InvalidSampleReason {
  return Number.isFinite(x) ? "decreasing-x" : "non-finite-x";
}

/**
 * @internal Return the index of the first X that is non-finite or below its predecessor
 * (`previous` for index 0), or `count` when all are valid. One comparison pair per sample.
 */
export function firstInvalidX(x: ArrayLike<number>, count: number, previous: number = MIN_X): number {
  let floor = previous;
  for (let i = 0; i < count; i++) {
    const value = x[i]!;
    if (!(value >= floor && value <= MAX_X)) return i;
    floor = value;
  }
  return count;
}

/**
 * @internal Throw a `RangeError` naming the first X that is non-finite or decreasing.
 * `label` names the position ("index", "row"), `hint` says how to fix it.
 */
export function assertSortedFiniteX(owner: string, x: ArrayLike<number>, count: number, hint: string, label: string = "index"): void {
  const bad = firstInvalidX(x, count);
  if (bad >= count) return;
  throw invalidXError(owner, x[bad]!, bad, bad > 0 ? x[bad - 1]! : NaN, hint, label);
}

/**
 * @internal Throw a `RangeError` when parallel input arrays differ in length. A mismatch is
 * almost always a bug in the caller's data pipeline, so it is reported instead of truncating.
 */
export function assertEqualLengths(owner: string, arrays: Readonly<Record<string, ArrayLike<number>>>): void {
  let firstName: string | undefined;
  let firstLength = 0;
  for (const name in arrays) {
    const length = arrays[name]!.length;
    if (firstName === undefined) {
      firstName = name;
      firstLength = length;
    } else if (length !== firstLength) {
      throw new RangeError(`${owner}: ${firstName} has ${firstLength} values but ${name} has ${length}.`);
    }
  }
}

/** @internal Build the `RangeError` thrown by static datasets for an invalid X. */
export function invalidXError(owner: string, value: number, index: number, previous: number, hint: string, label: string = "index"): RangeError {
  const reason = invalidXReason(value);
  const detail = reason === "non-finite-x"
    ? `X at ${label} ${index} is ${value}`
    : `X at ${label} ${index} is ${value}, below ${previous} at ${label} ${index - 1}`;
  return new RangeError(`${owner}: ${detail} (${reason}). X values must be finite and non-decreasing. ${hint}`);
}

/**
 * @internal Return a function that logs one console warning per dataset for skipped samples.
 * The warning is suppressed entirely when the caller observes samples through a callback.
 */
export function invalidSampleWarning(owner: string, silent: boolean): (reason: InvalidSampleReason, x: number, neighborX: number) => void {
  let warned = silent;
  return (reason, x, neighborX) => {
    if (warned) return;
    warned = true;
    const detail = reason === "non-finite-x" ? `non-finite X ${x}` : `X ${x} after ${neighborX}`;
    console.warn(
      `${owner} skipped a sample with ${detail} (${reason}). X values must be finite and non-decreasing. ` +
        "Later invalid samples are skipped silently; use rejectedSamples or onInvalidSample to track them.",
    );
  };
}

/**
 * @internal Return the indexes of samples with a finite X, stably sorted by X
 * (equal X values keep their input order).
 */
export function stableFiniteXOrder(x: ArrayLike<number>, count: number): Uint32Array {
  let kept = 0;
  const order = new Uint32Array(count);
  let sorted = true;
  let previous = MIN_X;
  for (let i = 0; i < count; i++) {
    const value = x[i]!;
    if (!Number.isFinite(value)) continue;
    if (value < previous) sorted = false;
    previous = value;
    order[kept++] = i;
  }
  const finite = order.subarray(0, kept);
  if (!sorted) finite.sort((a, b) => x[a]! - x[b]! || a - b);
  return finite;
}
