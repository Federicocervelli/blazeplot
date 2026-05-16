import type { LODView, Viewport } from "./types.js";
import { RingBuffer } from "./RingBuffer.js";

const MAX_LEVELS = 16;

export class MinMaxPyramid {
  private levels: Float32Array[] = [];
  private levelLengths: Uint32Array;
  private levelSampleWidths: Uint32Array;

  constructor(readonly bucketSize: number = 2) {
    if (!Number.isInteger(bucketSize) || bucketSize < 2) {
      throw new RangeError("MinMaxPyramid bucketSize must be an integer >= 2.");
    }

    this.levelLengths = new Uint32Array(MAX_LEVELS);
    this.levelSampleWidths = new Uint32Array(MAX_LEVELS);
  }

  build(source: RingBuffer): void {
    this.levels = [];
    this.levelLengths.fill(0);
    this.levelSampleWidths.fill(0);

    let srcLen = source.length;
    if (srcLen === 0) return;

    let prevLevel: Float32Array | null = null;
    let level = 0;

    while (srcLen > 0 && level < MAX_LEVELS) {
      const nextLen = Math.ceil(srcLen / this.bucketSize);
      const levelData = new Float32Array(nextLen * 2);

      for (let i = 0; i < srcLen; i += this.bucketSize) {
        let minY = Infinity;
        let maxY = -Infinity;
        const end = Math.min(i + this.bucketSize, srcLen);
        for (let j = i; j < end; j++) {
          if (prevLevel) {
            const prevMin = prevLevel[j * 2]!;
            const prevMax = prevLevel[j * 2 + 1]!;
            if (prevMin < minY) minY = prevMin;
            if (prevMax > maxY) maxY = prevMax;
          } else {
            const y = source.getY(j);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        const outIdx = Math.floor(i / this.bucketSize);
        levelData[outIdx * 2] = minY;
        levelData[outIdx * 2 + 1] = maxY;
      }

      this.levels[level] = levelData;
      this.levelLengths[level] = nextLen;
      this.levelSampleWidths[level] = this.bucketSize ** (level + 1);

      if (nextLen === 1) break;

      prevLevel = levelData;
      srcLen = nextLen;
      level++;
    }
  }

  query(_viewport: Viewport, pixelWidth: number, xRange: { start: number; length: number }): LODView {
    if (pixelWidth <= 0 || xRange.length <= 0) {
      return { buckets: new Float32Array(0), bucketCount: 0, level: 0, samplesPerPixel: 0 };
    }

    const visibleSamples = xRange.length;
    const samplesPerPixel = Math.max(1, visibleSamples / pixelWidth);
    const level = Math.min(
      Math.max(0, Math.ceil(Math.log2(samplesPerPixel)) - 1),
      this.levels.length - 1,
    );

    const levelData = this.levels[level];
    const levelLen = this.levelLengths[level];
    const sampleWidth = this.levelSampleWidths[level];
    if (!levelData || levelLen === undefined || sampleWidth === undefined || levelLen === 0 || sampleWidth === 0) {
      return { buckets: new Float32Array(0), bucketCount: 0, level: 0, samplesPerPixel };
    }

    const queryStart = Math.max(0, xRange.start);
    const queryEnd = queryStart + xRange.length;
    const bucketStart = Math.max(0, Math.floor(queryStart / sampleWidth));
    const bucketEnd = Math.min(levelLen, Math.ceil(queryEnd / sampleWidth));
    const count = bucketEnd - bucketStart;

    if (count <= 0) {
      return { buckets: new Float32Array(0), bucketCount: 0, level, samplesPerPixel };
    }

    const result = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const j = (bucketStart + i) * 2;
      result[i * 2] = levelData[j]!;
      result[i * 2 + 1] = levelData[j + 1]!;
    }

    return { buckets: result, bucketCount: count, level, samplesPerPixel };
  }
}
