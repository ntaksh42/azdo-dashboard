import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { PrReviewPanel } from "./PrReviewPanel";

// This project's vitest config has no global setup, so Testing Library's
// automatic per-test cleanup isn't registered; unmount explicitly so a prior
// render's panel doesn't leak into the next test's `screen` queries.
afterEach(cleanup);

// PrReviewPanel now renders a DockableWorkspace (storageKey "pr-review-panel"),
// which persists its dockview layout (incl. the active tab) to localStorage;
// clear it so one test's tab switch does not leak into the next test's render.
beforeEach(() => window.localStorage.clear());

const pr: ReviewPullRequestSummary = {
  organizationId: "contoso",
  projectId: "project-1",
  projectName: "Platform",
  repositoryId: "repo-1",
  repositoryName: "azdo-dashboard",
  pullRequestId: 999,
  title: "Test PR",
  createdBy: "Author",
  creationDate: "2026-06-14T00:00:00Z",
  targetRefName: "main",
  webUrl: "https://dev.azure.com/contoso/project/_git/repo/pullrequest/999",
  myVote: 0,
  myVoteLabel: "No vote",
  myIsRequired: false,
  isDraft: false,
  mergeStatus: null,
  ciStatus: null,
  ciContext: null,
  ciCheckCount: 0,
};

function renderPanel(selectedPr: ReviewPullRequestSummary = pr) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrReviewPanel selectedPr={selectedPr} />
    </QueryClientProvider>,
  );
}

describe("PrReviewPanel status actions", () => {
  it(
    "keeps review metadata in one compact row without an idle loading spacer",
    async () => {
      renderPanel();
      await screen.findByRole("button", { name: "Complete" }, { timeout: 8000 });

      const metadata = screen.getByRole("group", { name: "Pull request metadata" });
      expect(within(metadata).getByText(/Author/)).toBeTruthy();
      expect(within(metadata).getByText("1 / 2 approved")).toBeTruthy();
      expect(within(metadata).getByText(/Demo User/)).toBeTruthy();
      expect(
        metadata.parentElement?.nextElementSibling?.querySelector('[role="tab"]')?.textContent,
      ).toBe("Conversation");
    },
    15000,
  );

  it(
    "renders Complete inline and Abandon in the overflow menu for an active PR",
    async () => {
      renderPanel();
      expect(
        await screen.findByRole("button", { name: "Complete" }, { timeout: 8000 }),
      ).toBeTruthy();
      // Secondary actions (incl. Abandon) now live behind the "⋯" overflow menu.
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      expect(await screen.findByRole("menuitem", { name: "Abandon" })).toBeTruthy();
    },
    15000,
  );

  it(
    "offers Reactivate instead of Abandon for an abandoned PR",
    async () => {
      renderPanel({ ...pr, status: "abandoned" });
      await screen.findByRole("button", { name: "Complete" }, { timeout: 8000 });
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      expect(await screen.findByRole("menuitem", { name: "Reactivate" })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "Abandon" })).toBeNull();
    },
    15000,
  );
});

describe("PrReviewPanel Result tab", () => {
  // PR 101 is one of the demo PRs that resolves a review-result HTML file.
  const resultPr: ReviewPullRequestSummary = { ...pr, pullRequestId: 101 };

  it(
    "renders the HTML preview in a same-origin sandboxed iframe so it shows in the desktop WebView2 runtime",
    async () => {
      renderPanel(resultPr);

      const resultTab = await screen.findByRole(
        "tab",
        { name: "Result" },
        { timeout: 8000 },
      );
      fireEvent.pointerDown(resultTab, { button: 0 });

      // Wait for the preview query to resolve and render its iframe.
      const frame = (await screen.findByTitle(
        "Review result preview for PR101",
        undefined,
        { timeout: 8000 },
      )) as HTMLIFrameElement;

      // `allow-same-origin` is what makes the srcDoc render in WebView2; an
      // empty sandbox left the frame blank in the desktop app. `allow-scripts`
      // must stay off so the document still can't run JavaScript.
      const sandbox = frame.getAttribute("sandbox") ?? "";
      expect(sandbox.split(/\s+/).filter(Boolean)).toEqual(["allow-same-origin"]);
      expect(frame.getAttribute("srcdoc")).toContain("Rate limiting middleware review");
    },
    15000,
  );

  it(
    "zooms the preview with Ctrl+=/Ctrl+-/Ctrl+0, matching the zoom buttons' tooltips",
    async () => {
      renderPanel();
      await screen.findByRole("button", { name: "Complete" }, { timeout: 8000 });

      const panel = screen.getByRole("button", { name: "Reset preview zoom" }).closest("aside")!;
      expect(screen.getByRole("button", { name: "Reset preview zoom" }).textContent).toBe("100%");

      fireEvent.keyDown(panel, { key: "=", ctrlKey: true });
      expect(screen.getByRole("button", { name: "Reset preview zoom" }).textContent).toBe("110%");

      fireEvent.keyDown(panel, { key: "-", ctrlKey: true });
      fireEvent.keyDown(panel, { key: "-", ctrlKey: true });
      expect(screen.getByRole("button", { name: "Reset preview zoom" }).textContent).toBe("90%");

      fireEvent.keyDown(panel, { key: "0", ctrlKey: true });
      expect(screen.getByRole("button", { name: "Reset preview zoom" }).textContent).toBe("100%");
    },
    8000,
  );
});
