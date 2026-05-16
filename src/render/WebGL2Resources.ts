import type { Regl, Buffer as ReglBuffer } from "regl";

interface PoolEntry {
  buffer: ReglBuffer;
  floatArray: Float32Array;
  floatCapacity: number;
  inUse: boolean;
}

const POOL_SIZES = [1024, 4096, 16384, 32768, 131072];

export class WebGL2Resources {
  private readonly regl: Regl;
  private readonly pool: PoolEntry[] = [];
  private preAllocated: boolean = false;

  constructor(regl: Regl) {
    this.regl = regl;
  }

  get reglInstance(): Regl {
    return this.regl;
  }

  preAllocate(): void {
    if (this.preAllocated) return;
    this.preAllocated = true;

    for (const size of POOL_SIZES) {
      this.pool.push(this.createEntry(size, "stream"));
    }
  }

  acquire(floatCount: number, usage: "static" | "dynamic" | "stream" = "stream"): { buffer: ReglBuffer; array: Float32Array } {
    const needed = floatCount;
    let entry = this.findFree(needed);
    if (!entry) {
      const capacity = this.roundUp(needed);
      entry = this.createEntry(capacity, usage);
      this.pool.push(entry);
    }
    entry.inUse = true;
    return { buffer: entry.buffer, array: entry.floatArray };
  }

  release(buffer: ReglBuffer): void {
    for (const entry of this.pool) {
      if (entry.buffer === buffer) {
        entry.inUse = false;
        return;
      }
    }
  }

  destroy(): void {
    for (const entry of this.pool) {
      entry.buffer.destroy();
    }
    this.pool.length = 0;
    this.preAllocated = false;
  }

  private createEntry(floatCapacity: number, usage: "static" | "dynamic" | "stream"): PoolEntry {
    return {
      buffer: this.regl.buffer({
        length: floatCapacity * 4,
        usage,
        type: "float",
      }),
      floatArray: new Float32Array(floatCapacity),
      floatCapacity,
      inUse: false,
    };
  }

  private findFree(minCapacity: number): PoolEntry | undefined {
    return this.pool.find(e => !e.inUse && e.floatCapacity >= minCapacity);
  }

  private roundUp(n: number): number {
    for (const size of POOL_SIZES) {
      if (size >= n) return size;
    }
    const highest = POOL_SIZES[POOL_SIZES.length - 1]!;
    const nextPower = 1 << (32 - Math.clz32(n - 1));
    return Math.max(highest * 2, nextPower);
  }
}
