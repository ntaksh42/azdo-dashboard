import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DockableWorkspace, type DockablePanelSpec } from "./DockableWorkspace";

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
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
});

function twoPanels(overrides: Partial<{ grid: React.ReactNode; preview: React.ReactNode }> = {}): DockablePanelSpec[] {
  return [
    { id: "grid", title: "Grid", content: overrides.grid ?? <div>grid content</div>, minWidth: 480 },
    {
      id: "preview",
      title: "Preview",
      content: overrides.preview ?? <div>preview content</div>,
      position: { relativeTo: "grid", direction: "right" },
      initialWidth: 420,
      minWidth: 280,
      maxWidth: 8192,
    },
  ];
}

function renderWorkspace(storageKey = "test:dockable-workspace", panels = twoPanels()) {
  render(<DockableWorkspace storageKey={storageKey} panels={panels} />);
  return screen.getByRole("separator", { name: "Resize Preview" });
}

describe("DockableWorkspace", () => {
  it("uses dockview's light theme when the app is in light mode", () => {
    renderWorkspace("test:dockable-workspace:light-theme");

    expect(document.querySelector(".dockview-theme-light")).toBeTruthy();
    expect(document.querySelector(".dockview-theme-vs")).toBeNull();
  });

  it("keeps dockview tab bars compact", () => {
    renderWorkspace("test:dockable-workspace:compact-tabs");

    const dockview = document.querySelector(".dv-dockview");
    expect(getComputedStyle(dockview!).getPropertyValue("--dv-tabs-and-actions-container-height")).toBe(
      "20px",
    );
  });

  it("keeps dockview tab bars compact in dark mode", () => {
    document.documentElement.classList.add("dark");
    renderWorkspace("test:dockable-workspace:compact-tabs-dark");

    const dockview = document.querySelector(".dv-dockview");
    expect(getComputedStyle(dockview!).getPropertyValue("--dv-tabs-and-actions-container-height")).toBe(
      "20px",
    );
  });

  it("sizes the split panel to its initialWidth and renders every panel", () => {
    renderWorkspace();
    expect(screen.getByText("grid content")).toBeTruthy();
    expect(screen.getByText("preview content")).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize Preview" }).getAttribute("aria-valuenow")).toBe(
      "420",
    );
  });

  it("resizes a panel from the keyboard and persists the layout", () => {
    const storageKey = "test:dockable-workspace:persist";
    const resize = renderWorkspace(storageKey);

    fireEvent.keyDown(resize, { key: "ArrowLeft" });
    expect(resize.getAttribute("aria-valuenow")).toBe("436");
    expect(window.localStorage.getItem(storageKey)).toBeTruthy();

    fireEvent.doubleClick(resize);
    expect(resize.getAttribute("aria-valuenow")).toBe("420");
  });

  it("reflects updated panel content on rerender", () => {
    const storageKey = "test:dockable-workspace:content";
    const { rerender } = render(
      <DockableWorkspace storageKey={storageKey} panels={twoPanels({ grid: <div>grid v1</div>, preview: <div>preview v1</div> })} />,
    );
    expect(screen.getByText("grid v1")).toBeTruthy();
    expect(screen.getByText("preview v1")).toBeTruthy();

    rerender(
      <DockableWorkspace storageKey={storageKey} panels={twoPanels({ grid: <div>grid v2</div>, preview: <div>preview v2</div> })} />,
    );
    expect(screen.getByText("grid v2")).toBeTruthy();
    expect(screen.getByText("preview v2")).toBeTruthy();
    expect(screen.queryByText("grid v1")).toBeNull();
    expect(screen.queryByText("preview v1")).toBeNull();
  });

  it("clamps keyboard resize to minWidth, and to the space left by the anchor's minimum width", () => {
    const resize = renderWorkspace("test:dockable-workspace:clamp");

    for (let i = 0; i < 10; i += 1) {
      fireEvent.keyDown(resize, { key: "ArrowRight" });
    }
    expect(Number(resize.getAttribute("aria-valuenow"))).toBe(280);

    // maxWidth is 8192, but the 1200px mocked container leaves only
    // 1200 - grid minWidth(480) = 720px for the preview panel to grow into.
    for (let i = 0; i < 60; i += 1) {
      fireEvent.keyDown(resize, { key: "ArrowLeft" });
    }
    expect(Number(resize.getAttribute("aria-valuenow"))).toBe(720);
  });

  it("restores a previously persisted width across a remount", () => {
    const storageKey = "test:dockable-workspace:restore";
    const { unmount } = render(<DockableWorkspace storageKey={storageKey} panels={twoPanels()} />);
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Preview" }), { key: "ArrowLeft" });
    expect(screen.getByRole("separator", { name: "Resize Preview" }).getAttribute("aria-valuenow")).toBe(
      "436",
    );
    expect(window.localStorage.getItem(storageKey)).toBeTruthy();
    unmount();

    render(<DockableWorkspace storageKey={storageKey} panels={twoPanels()} />);
    expect(screen.getByRole("separator", { name: "Resize Preview" }).getAttribute("aria-valuenow")).toBe(
      "436",
    );
  });

  it("falls back to the default layout when the persisted JSON is corrupt", () => {
    const storageKey = "test:dockable-workspace:corrupt";
    window.localStorage.setItem(storageKey, "not valid json");

    const resize = renderWorkspace(storageKey);
    expect(resize.getAttribute("aria-valuenow")).toBe("420");
    expect(screen.getByText("grid content")).toBeTruthy();
    expect(screen.getByText("preview content")).toBeTruthy();
  });

  it("supports more than two panels, each independently resizable", () => {
    const panels: DockablePanelSpec[] = [
      { id: "grid", title: "Grid", content: <div>grid content</div>, minWidth: 480 },
      {
        id: "preview",
        title: "Preview",
        content: <div>preview content</div>,
        position: { relativeTo: "grid", direction: "right" },
        initialWidth: 420,
        minWidth: 280,
        maxWidth: 8192,
      },
      {
        id: "result",
        title: "Result",
        content: <div>result content</div>,
        position: { relativeTo: "preview", direction: "right" },
        initialWidth: 320,
        minWidth: 200,
        maxWidth: 8192,
      },
    ];
    render(<DockableWorkspace storageKey="test:dockable-workspace:three" panels={panels} />);

    expect(screen.getByText("grid content")).toBeTruthy();
    expect(screen.getByText("preview content")).toBeTruthy();
    expect(screen.getByText("result content")).toBeTruthy();

    const previewResize = screen.getByRole("separator", { name: "Resize Preview" });
    const resultResize = screen.getByRole("separator", { name: "Resize Result" });
    // Splitting Result out of Preview carves Result's initialWidth directly
    // out of Preview's own space (dockview splits the referenced panel, not
    // the row's free space), so Preview lands at its floor here rather than
    // its own initialWidth -- both panels remain independently resizable.
    expect(previewResize.getAttribute("aria-valuenow")).toBe("280");
    expect(resultResize.getAttribute("aria-valuenow")).toBe("320");

    fireEvent.keyDown(resultResize, { key: "ArrowLeft" });
    expect(resultResize.getAttribute("aria-valuenow")).toBe("336");
    // Resizing Result does not disturb Preview's own reported width.
    expect(previewResize.getAttribute("aria-valuenow")).toBe("280");
  });
});
