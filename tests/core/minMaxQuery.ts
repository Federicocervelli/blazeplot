import { MinMaxTree } from "../../src/core/MinMaxTree.ts";
import type { MinMaxOut, MinMaxY } from "../../src/core/MinMaxTree.ts";

/** Allocating wrappers over the tree's allocation-free queries, for readable assertions. */
export function query(tree: MinMaxTree, start: number, end: number): MinMaxY | null {
  const out: MinMaxOut = { minY: 0, maxY: 0 };
  return tree.queryInto(start, end, out) ? out : null;
}

export function queryRing(tree: MinMaxTree, start: number, count: number): MinMaxY | null {
  const out: MinMaxOut = { minY: 0, maxY: 0 };
  return tree.queryRingInto(start, count, out) ? out : null;
}
