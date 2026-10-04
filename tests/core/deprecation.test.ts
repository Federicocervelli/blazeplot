import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { resetDeprecationWarnings, warnDeprecated } from "../../src/core/deprecation";

describe("warnDeprecated", () => {
  const originalEnv = process.env.NODE_ENV;
  let warn: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetDeprecationWarnings();
    process.env.NODE_ENV = "development";
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  test("warns once per id with the BlazePlot prefix", () => {
    warnDeprecated("a", "a() is deprecated since 1.3.0; use b() instead.");
    warnDeprecated("a", "a() is deprecated since 1.3.0; use b() instead.");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("BlazePlot: a() is deprecated since 1.3.0; use b() instead.");
  });

  test("distinct ids each warn", () => {
    warnDeprecated("a", "first");
    warnDeprecated("b", "second");
    warnDeprecated("a", "first");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test("is silent in production and does not consume the id", () => {
    process.env.NODE_ENV = "production";
    warnDeprecated("a", "msg");
    expect(warn).not.toHaveBeenCalled();
    process.env.NODE_ENV = "development";
    warnDeprecated("a", "msg");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("reset allows an id to warn again", () => {
    warnDeprecated("a", "msg");
    resetDeprecationWarnings();
    warnDeprecated("a", "msg");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
