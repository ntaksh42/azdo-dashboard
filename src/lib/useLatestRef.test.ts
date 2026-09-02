import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLatestRef } from "./useLatestRef";

describe("useLatestRef", () => {
  it("returns the initial value on first render", () => {
    const { result } = renderHook((value: number) => useLatestRef(value), {
      initialProps: 1,
    });
    expect(result.current.current).toBe(1);
  });

  it("updates .current to the latest value on rerender without changing ref identity", () => {
    const { result, rerender } = renderHook((value: number) => useLatestRef(value), {
      initialProps: 1,
    });
    const ref = result.current;
    rerender(2);
    expect(result.current).toBe(ref);
    expect(result.current.current).toBe(2);
  });
});
