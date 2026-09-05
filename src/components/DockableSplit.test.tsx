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

  it("reflects updated grid/preview content on rerender", () => {
    const storageKey = "test:dockable-split:content";
    const props = {
      storageKey,
      gridTitle: "Grid",
      previewTitle: "Preview",
      defaultPreviewWidth: 420,
      minPreviewWidth: 280,
      maxPreviewWidth: 8192,
    };
    const { rerender } = render(
      <DockableSplit {...props} grid={<div>grid v1</div>} preview={<div>preview v1</div>} />,
    );
    expect(screen.getByText("grid v1")).toBeTruthy();
    expect(screen.getByText("preview v1")).toBeTruthy();

    rerender(<DockableSplit {...props} grid={<div>grid v2</div>} preview={<div>preview v2</div>} />);
    expect(screen.getByText("grid v2")).toBeTruthy();
    expect(screen.getByText("preview v2")).toBeTruthy();
    expect(screen.queryByText("grid v1")).toBeNull();
    expect(screen.queryByText("preview v1")).toBeNull();
  });

  it("clamps keyboard resize to minPreviewWidth, and to the space left by the grid's minimum width", () => {
    const resize = renderSplit("test:dockable-split:clamp");

    for (let i = 0; i < 10; i += 1) {
      fireEvent.keyDown(resize, { key: "ArrowRight" });
    }
    expect(Number(resize.getAttribute("aria-valuenow"))).toBe(280);

    // maxPreviewWidth is 8192, but the 1200px mocked container leaves only
    // 1200 - minGridWidth(480) = 720px for the preview panel to grow into.
    for (let i = 0; i < 60; i += 1) {
      fireEvent.keyDown(resize, { key: "ArrowLeft" });
    }
    expect(Number(resize.getAttribute("aria-valuenow"))).toBe(720);
  });

  it("restores a previously persisted width across a remount", () => {
    const storageKey = "test:dockable-split:restore";
    const { unmount } = render(
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
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize preview" }), { key: "ArrowLeft" });
    expect(screen.getByRole("separator", { name: "Resize preview" }).getAttribute("aria-valuenow")).toBe(
      "436",
    );
    expect(window.localStorage.getItem(storageKey)).toBeTruthy();
    unmount();

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
    expect(screen.getByRole("separator", { name: "Resize preview" }).getAttribute("aria-valuenow")).toBe(
      "436",
    );
  });

  it("falls back to the default layout when the persisted JSON is corrupt", () => {
    const storageKey = "test:dockable-split:corrupt";
    window.localStorage.setItem(storageKey, "not valid json");

    const resize = renderSplit(storageKey);
    expect(resize.getAttribute("aria-valuenow")).toBe("420");
    expect(screen.getByText("grid content")).toBeTruthy();
    expect(screen.getByText("preview content")).toBeTruthy();
  });
});
