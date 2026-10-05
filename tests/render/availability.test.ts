import { describe, expect, it } from "bun:test";
import { isWebGL2Available } from "../../src/render/webgl2/availability.ts";

describe("isWebGL2Available", () => {
  it("probes the document it is given", () => {
    const created: string[] = [];
    const doc = {
      createElement: (tag: string) => {
        created.push(tag);
        return { getContext: () => null };
      },
    } as unknown as Document;
    expect(isWebGL2Available(doc)).toBe(false);
    expect(created).toEqual(["canvas"]);
  });
});
