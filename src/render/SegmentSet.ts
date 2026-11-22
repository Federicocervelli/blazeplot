/**
 * Points in a row of a segment set's point texture. Engines that upload points as a texture lay them out in rows
 * this wide, so the CPU copy is padded to whole rows and a change uploads whole rows. 2048 is the smallest
 * texture size WebGL2 guarantees.
 */
export const SEGMENT_SET_ROW = 2048;

/** What a non-finite coordinate is stored as (as a 32-bit float). */
export const SEGMENT_SET_HOLE = Math.fround(3e38);
/** Engines skip a segment with a coordinate larger than this in magnitude: a hole. */
export const SEGMENT_SET_HOLE_LIMIT = 1e38;

/**
 * @internal The engine-neutral storage behind a `ChartSegmentSet`: CPU copies of the points (padded to whole
 * rows of {@link SEGMENT_SET_ROW}) and the index pairs, which Canvas 2D draws from and GPU engines upload. Engines
 * keep their own GPU copies keyed by the set, compare `version` to know when points changed, and register
 * `onRelease` to free them on `dispose`.
 */
export class SegmentSet {
  readonly pointCount: number;
  readonly segmentCount: number;
  /** `x, y` per point, then zeros to the end of the last row. A non-finite coordinate is stored as {@link SEGMENT_SET_HOLE}. */
  points: Float32Array;
  /** Two point indices per segment; an index past the last point means the segment is not drawn. */
  ends: Uint32Array;
  /** Bumped by every `setPoints`. */
  version = 0;
  /** The points the last `setPoints` changed, `[from, to)`: a copy one version behind needs only these. */
  changedFrom = 0;
  changedTo = 0;
  disposed = false;
  private readonly releases = new Set<() => void>();

  constructor(points: Float32Array, pointCount: number, ends: Uint32Array, segmentCount: number) {
    this.pointCount = Math.max(0, Math.min(Math.floor(pointCount) || 0, Math.floor(points.length / 2)));
    this.segmentCount = Math.max(0, Math.min(Math.floor(segmentCount) || 0, Math.floor(ends.length / 2)));
    const rows = Math.max(1, Math.ceil(this.pointCount / SEGMENT_SET_ROW));
    this.points = new Float32Array(rows * SEGMENT_SET_ROW * 2);
    this.write(points, 0, this.pointCount);
    this.ends = ends.slice(0, this.segmentCount * 2);
  }

  setPoints(points: Float32Array, first = 0): void {
    if (this.disposed) return;
    const start = Math.max(0, Math.floor(first) || 0);
    const count = Math.min(Math.floor(points.length / 2), this.pointCount - start);
    if (count <= 0) return;
    this.write(points, start, count);
    this.version++;
    this.changedFrom = start;
    this.changedTo = start + count;
  }

  /** Register `release`, called once on `dispose`; returns a function that unregisters it. */
  onRelease(release: () => void): () => void {
    this.releases.add(release);
    return () => this.releases.delete(release);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const releases = [...this.releases];
    this.releases.clear();
    this.points = new Float32Array(0);
    this.ends = new Uint32Array(0);
    for (const release of releases) release();
  }

  private write(points: Float32Array, first: number, count: number): void {
    const target = this.points;
    for (let i = 0; i < count * 2; i++) {
      const v = points[i]!;
      target[first * 2 + i] = Number.isFinite(v) ? v : SEGMENT_SET_HOLE;
    }
  }
}

/**
 * @internal The segments `style` asks for, clamped to the set: `[first, end)`, empty when the set is disposed or
 * the transform or width is not usable.
 */
export function segmentSetRange(set: SegmentSet, style: { readonly first?: number; readonly count?: number; readonly scaleX: number; readonly scaleY: number; readonly offsetX: number; readonly offsetY: number; readonly width: number }): [number, number] {
  if (set.disposed || !Number.isFinite(style.scaleX + style.scaleY + style.offsetX + style.offsetY) || !(style.width > 0) || !Number.isFinite(style.width)) return [0, 0];
  const first = Math.max(0, Math.min(set.segmentCount, Math.floor(style.first ?? 0) || 0));
  const count = style.count === undefined ? set.segmentCount - first : Math.max(0, Math.floor(style.count) || 0);
  return [first, Math.min(set.segmentCount, first + count)];
}
