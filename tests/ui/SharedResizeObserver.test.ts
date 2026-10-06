import { beforeEach, describe, expect, it } from "bun:test";
import { observeResize } from "../../src/ui/SharedResizeObserver.ts";
import { FakeResizeObserver } from "./fakes.ts";
import { useChartHarness } from "./harness.ts";

const h = useChartHarness();

const view = (): Window & typeof globalThis => window as unknown as Window & typeof globalThis;

beforeEach(() => {
  FakeResizeObserver.reset();
});

describe("shared ResizeObserver", () => {
  it("serves every chart in a window with one observer and routes notifications to the right chart", () => {
    const a = h.make();
    const b = h.make();
    expect(FakeResizeObserver.instances).toHaveLength(1);
    const observer = FakeResizeObserver.instances[0]!;
    expect(observer.observed.size).toBe(2);

    let resizes = 0;
    const original = a.resize.bind(a);
    a.resize = (pixelRatio) => {
      resizes++;
      return original(pixelRatio);
    };
    observer.trigger([...observer.observed].slice(1));
    expect(resizes).toBe(0);
    observer.trigger([...observer.observed].slice(0, 1));
    expect(resizes).toBe(1);
    a.dispose();
    b.dispose();
  });

  it("stops observing a disposed chart and disconnects with the last one", () => {
    const a = h.make();
    const b = h.make();
    const observer = FakeResizeObserver.instances[0]!;
    a.dispose();
    expect(observer.observed.size).toBe(1);
    expect(observer.disconnected).toBe(false);
    b.dispose();
    expect(observer.observed.size).toBe(0);
    expect(observer.disconnected).toBe(true);

    // A later chart gets a new observer instead of the disconnected one.
    h.make().dispose();
    expect(FakeResizeObserver.instances).toHaveLength(2);
  });

  it("isolates a failing callback from the others and rethrows the first error", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const calls: string[] = [];
    const stopFirst = observeResize(view(), first, () => {
      calls.push("first");
      throw new Error("boom");
    })!;
    const stopSecond = observeResize(view(), second, () => calls.push("second"))!;
    expect(() => FakeResizeObserver.instances[0]!.trigger()).toThrow("boom");
    expect(calls).toEqual(["first", "second"]);
    stopFirst();
    stopFirst();
    stopSecond();
    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
  });
});
