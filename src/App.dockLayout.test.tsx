import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organization, renderApp } from "./test/appTestHelpers";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: () => Promise.resolve(),
  openPath: () => Promise.resolve(),
}));

describe("App — Dock Layout", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.localStorage.clear();
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_app_settings") return Promise.resolve({ reviewResultFolderPath: null });
      if (command === "get_review_result_preview") return Promise.resolve(null);
      if (command === "list_sync_states") return Promise.resolve([]);
      if (command === "trigger_sync") return Promise.resolve(undefined);
      if (command === "list_organizations") return Promise.resolve([organization]);
      if (command === "get_active_organization") return Promise.resolve(organization);
      if (command === "list_my_review_pull_requests") return Promise.resolve([]);
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    cleanup();
  });

  it("keeps a previously opened view docked as its own tab alongside a newly opened one", async () => {
    renderApp();
    const main = within(await screen.findByRole("main"));
    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();

    const nav = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    fireEvent.click(nav.getByRole("button", { name: "Commits" }));
    expect(await main.findByRole("heading", { name: "Commits" })).toBeTruthy();

    // Both views stay open as separate tabs rather than replacing one another.
    expect(await screen.findByRole("tab", { name: "My Reviews" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Commits" })).toBeTruthy();
  });

  it("closes a docked view's tab and reopens it from the sidebar", async () => {
    renderApp();
    const main = within(await screen.findByRole("main"));
    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();

    const nav = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    fireEvent.click(nav.getByRole("button", { name: "Commits" }));
    expect(await main.findByRole("heading", { name: "Commits" })).toBeTruthy();

    const myReviewsTab = await screen.findByRole("tab", { name: "My Reviews" });
    fireEvent.click(within(myReviewsTab).getByRole("button", { name: "Close tab" }));
    expect(screen.queryByRole("tab", { name: "My Reviews" })).toBeNull();

    fireEvent.click(nav.getByRole("button", { name: "My Reviews" }));
    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();
    expect(await screen.findByRole("tab", { name: "My Reviews" })).toBeTruthy();
  });

  it("restores which views were docked open across a remount", async () => {
    renderApp();
    const main = within(await screen.findByRole("main"));
    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();

    const nav = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    fireEvent.click(nav.getByRole("button", { name: "Commits" }));
    expect(await main.findByRole("heading", { name: "Commits" })).toBeTruthy();
    // Let the layout-change listener persist the two-tab layout before remounting.
    await screen.findByRole("tab", { name: "My Reviews" });

    cleanup();
    renderApp();
    const remounted = within(await screen.findByRole("main"));
    expect(await remounted.findByRole("heading", { name: "Commits" })).toBeTruthy();
    expect(await screen.findByRole("tab", { name: "My Reviews" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Commits" })).toBeTruthy();
  });
});
