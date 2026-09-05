import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DockableSplit } from "./DockableSplit";

// jsdom reports 0 for every layout dimension, so dockview would clamp every
// panel to its minimum regardless of the requested width. Mock a realistic
// container size so these assertions exercise real dockview sizing math.
beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSplit(storageKey = "test:dockable-split") {
  render(
    <DockableSplit
      storageKey={storageKey}
      gridTitle="Grid"
      previewTitle="Preview"
      grid={<div>grid content</div>}
      preview={<div>preview content</div>}
      defaultPreviewWidth={420}
      minPreviewWidth={280}
      maxPreviewWidth={8192}
    />,
  );
  return screen.getByRole("separator", { name: "Resize preview" });
}

describe("DockableSplit", () => {
  it("sizes the preview panel to defaultPreviewWidth and renders both panes", () => {
    renderSplit();
    expect(screen.getByText("grid content")).toBeTruthy();
    expect(screen.getByText("preview content")).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize preview" }).getAttribute("aria-valuenow")).toBe(
      "420",
    );
  });

  it("resizes the preview panel from the keyboard and persists the layout", () => {
    const storageKey = "test:dockable-split:persist";
    const resize = renderSplit(storageKey);

    fireEvent.keyDown(resize, { key: "ArrowLeft" });
    expect(resize.getAttribute("aria-valuenow")).toBe("436");
    expect(window.localStorage.getItem(storageKey)).toBeTruthy();

    fireEvent.doubleClick(resize);
    expect(resize.getAttribute("aria-valuenow")).toBe("420");
  });
});
