import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "./ResizeHandle";

describe("ResizeHandle", () => {
  it("does not start a parent pointer gesture while resizing", () => {
    const onParentPointerDown = vi.fn();

    render(
      <div onPointerDown={onParentPointerDown}>
        <ResizeHandle
          ariaLabel="Resize preview"
          direction={-1}
          min={280}
          max={800}
          onChange={() => {}}
          onReset={() => {}}
          value={420}
        />
      </div>,
    );

    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize preview" }), {
      clientX: 500,
      pointerId: 1,
    });

    expect(onParentPointerDown).not.toHaveBeenCalled();
  });
});
