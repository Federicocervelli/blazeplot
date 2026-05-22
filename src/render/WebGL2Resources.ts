interface PoolEntry {
  buffer: WebGLBuffer;
  byteCapacity: number;
  target: number;
  usage: number;
  inUse: boolean;
}

const POOL_SIZES = [1024, 4096, 16384, 32768, 131072];

/** WebGL buffer acquired from the resource pool. */
export interface WebGL2ResourceBuffer {
  readonly buffer: WebGLBuffer;
  readonly byteCapacity: number;
}

/** Small WebGL2 buffer pool used by the native backend. */
export class WebGL2Resources {
  private readonly pool: PoolEntry[] = [];
  private preAllocated: boolean = false;

  /** Create a resource pool for a WebGL2 context. */
  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** Preallocate common streaming buffer sizes. */
  preAllocate(): void {
    if (this.preAllocated) return;
    this.preAllocated = true;

    for (const size of POOL_SIZES) {
      this.pool.push(this.createEntry(size * Float32Array.BYTES_PER_ELEMENT, this.gl.ARRAY_BUFFER, this.gl.STREAM_DRAW));
    }
  }

  acquire(
    elementCount: number,
    usage: "static" | "dynamic" | "stream" = "stream",
    type: "float" | "element" = "float",
  ): WebGL2ResourceBuffer {
    const target = type === "element" ? this.gl.ELEMENT_ARRAY_BUFFER : this.gl.ARRAY_BUFFER;
    const byteLength = elementCount * (type === "element" ? Uint16Array.BYTES_PER_ELEMENT : Float32Array.BYTES_PER_ELEMENT);
    const glUsage = this.toGlUsage(usage);
    let entry = this.findFree(byteLength, target, glUsage);
    if (!entry) {
      const capacity = this.roundUp(byteLength);
      entry = this.createEntry(capacity, target, glUsage);
      this.pool.push(entry);
    }
    entry.inUse = true;
    return { buffer: entry.buffer, byteCapacity: entry.byteCapacity };
  }

  /** Mark a pooled buffer as available for reuse. */
  release(buffer: WebGLBuffer): void {
    for (const entry of this.pool) {
      if (entry.buffer === buffer) {
        entry.inUse = false;
        return;
      }
    }
  }

  /** Delete all pooled WebGL buffers. */
  destroy(): void {
    for (const entry of this.pool) {
      this.gl.deleteBuffer(entry.buffer);
    }
    this.pool.length = 0;
    this.preAllocated = false;
  }

  private createEntry(byteCapacity: number, target: number, usage: number): PoolEntry {
    const buffer = this.gl.createBuffer();
    if (!buffer) {
      throw new Error("Failed to allocate WebGL buffer.");
    }
    this.gl.bindBuffer(target, buffer);
    this.gl.bufferData(target, byteCapacity, usage);
    return {
      buffer,
      byteCapacity,
      target,
      usage,
      inUse: false,
    };
  }

  private findFree(minByteCapacity: number, target: number, usage: number): PoolEntry | undefined {
    return this.pool.find(e => !e.inUse && e.target === target && e.usage === usage && e.byteCapacity >= minByteCapacity);
  }

  private roundUp(byteLength: number): number {
    for (const size of POOL_SIZES) {
      const bytes = size * Float32Array.BYTES_PER_ELEMENT;
      if (bytes >= byteLength) return bytes;
    }
    const highest = POOL_SIZES[POOL_SIZES.length - 1]! * Float32Array.BYTES_PER_ELEMENT;
    const nextPower = 1 << (32 - Math.clz32(byteLength - 1));
    return Math.max(highest * 2, nextPower);
  }

  private toGlUsage(usage: "static" | "dynamic" | "stream"): number {
    switch (usage) {
      case "static":
        return this.gl.STATIC_DRAW;
      case "dynamic":
        return this.gl.DYNAMIC_DRAW;
      case "stream":
        return this.gl.STREAM_DRAW;
    }
  }
}
