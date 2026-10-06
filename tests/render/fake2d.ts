export type Call = readonly [string, ...unknown[]];

/** Records Path2D-style calls. */
export class FakePath {
  readonly calls: Call[] = [];
  moveTo(x: number, y: number): void {
    this.calls.push(["moveTo", x, y]);
  }
  lineTo(x: number, y: number): void {
    this.calls.push(["lineTo", x, y]);
  }
  rect(...args: number[]): void {
    this.calls.push(["rect", ...args]);
  }
  arc(...args: number[]): void {
    this.calls.push(["arc", ...args]);
  }
  closePath(): void {
    this.calls.push(["closePath"]);
  }
}

/** Canvas 2D context double that records every call, for asserting on what an engine draws. */
export class FakeContext2D extends FakePath {
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 0;
  lineJoin = "";
  lineCap = "";
  lost = false;
  setTransform(...args: number[]): void {
    this.calls.push(["setTransform", ...args]);
  }
  clearRect(...args: number[]): void {
    this.calls.push(["clearRect", ...args]);
  }
  beginPath(): void {
    this.calls.push(["beginPath"]);
  }
  stroke(): void {
    this.calls.push(["stroke", this.strokeStyle, this.lineWidth]);
  }
  fill(path?: FakePath): void {
    this.calls.push(["fill", this.fillStyle, path ? path.calls.length : -1]);
  }
  fillRect(...args: number[]): void {
    this.calls.push(["fillRect", this.fillStyle, ...args]);
  }
  drawImage(...args: unknown[]): void {
    this.calls.push(["drawImage", ...args]);
  }
  isContextLost(): boolean {
    return this.lost;
  }
}

/** A canvas double that hands out `ctx` for "2d" and supports events. */
export function fakeCanvas2d(ctx: FakeContext2D): HTMLCanvasElement {
  return Object.assign(new EventTarget(), { width: 100, height: 50, getContext: (kind: string) => (kind === "2d" ? ctx : null) }) as unknown as HTMLCanvasElement;
}
