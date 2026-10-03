import type { ValuePrecision } from "./types.js";

/** Allocate a value array with the requested precision. */
export function createValueArray(length: number, precision: ValuePrecision = "float32"): Float32Array | Float64Array {
  return precision === "float64" ? new Float64Array(length) : new Float32Array(length);
}
