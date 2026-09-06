import { lazy, Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  commandErrorMessage,
  getPullRequestReview,
  prLocator,
  removePullRequestReviewer,
  setPullRequestReviewerRequired,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { focusPrimaryGrid, isEditableTarget } from "@/lib/utils";
import { usePreviewZoom } from "@/lib/usePreviewZoom";
import { LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { DockableWorkspace, type DockablePanelSpec } from "@/components/DockableWorkspace";
import { PrReviewHeader } from "./PrReviewHeader";
import { ReviewTab } from "./PrReviewTabContents";
import { CommitsTab } from "./PrCommitsTab";
import { ResultTab } from "./PrSecondaryTabs";

// The Files tab pulls in the `diff` library, so it is code-split to keep that
// weight out of the startup bundle.
const PrFilesTab = lazy(() =>
  import("./PrFilesTab").then((m) => ({ default: m.PrFilesTab })),
);

export function PrReviewPanel({
  selectedPr,
  maximized = false,
  onToggleMaximize,
}: {
  selectedPr: ReviewPullRequestSummary | null;
  maximized?: boolean;
  onToggleMaximize?: () => void;
}) {
  const { canZoomIn, canZoomOut, resetZoom, zoom, zoomIn, zoomOut } = usePreviewZoom();

  const reviewQuery = useQuery({
    queryKey: [
      "prReview",
      selectedPr?.organizationId,
      selectedPr?.repositoryId,
      selectedPr?.pullRequestId,
    ],
    queryFn: () => getPullRequestReview(prLocator(selectedPr as ReviewPullRequestSummary)),
    enabled: !!selectedPr,
    staleTime: 60_000,
  });

  // Reviewer management lives in the header now, but the mutations belong to the
  // panel (which owns the review query) so the header can stay presentational.
  const queryClient = useQueryClient();
  const [reviewerError, setReviewerError] = useState<string | null>(null);
  function invalidateReviewerData() {
    if (!selectedPr) return;
    void queryClient.invalidateQueries({
      queryKey: ["prReview", selectedPr.organizationId, selectedPr.repositoryId, selectedPr.pullRequestId],
    });
    void queryClient.invalidateQueries({ queryKey: ["myReviews", selectedPr.organizationId] });
  }
  const reviewerRequiredMutation = useMutation({
    mutationFn: setPullRequestReviewerRequired,
    onSuccess: () => {
      setReviewerError(null);
      invalidateReviewerData();
    },
    onError: (error) => setReviewerError(commandErrorMessage(error)),
  });
  const removeReviewerMutation = useMutation({
    mutationFn: removePullRequestReviewer,
    onSuccess: () => {
      setReviewerError(null);
      invalidateReviewerData();
    },
    onError: (error) => setReviewerError(commandErrorMessage(error)),
  });
  const reviewerActionsBusy = reviewerRequiredMutation.isPending || removeReviewerMutation.isPending;

  // Esc / ← step back to the grid from anywhere in the preview that is not a
  // text field (composer Esc is handled locally and stops propagation first).
  function handlePreviewKeyDown(event: React.KeyboardEvent) {
    // Ctrl/Cmd +, -, 0 zoom the preview, matching the buttons' tooltips.
    // Checked before the editable-target bailout below so it also works while
    // a comment editor has focus, same as a browser's own zoom keys.
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetZoom();
        return;
      }
    }
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusPrimaryGrid();
    }
  }

  const noPrSelected = <PreviewEmptyState message="Select a pull request." />;

  // Order/labels mirror GitHub's PR tabs (Conversation, Commits, Files
  // changed); Result stays included even without a configured folder since
  // ResultTab renders its own "not configured" empty state.
  const panels: DockablePanelSpec[] = [
    {
      id: "review",
      title: "Conversation",
      content: !selectedPr ? (
        noPrSelected
      ) : (
        <ReviewTab
          pr={selectedPr}
          review={reviewQuery.data ?? null}
          loading={reviewQuery.isLoading}
          error={reviewQuery.isError ? commandErrorMessage(reviewQuery.error) : null}
        />
      ),
    },
    {
      id: "commits",
      title: "Commits",
      content: !selectedPr ? noPrSelected : <CommitsTab pr={selectedPr} />,
      position: { relativeTo: "review", direction: "within" },
    },
    {
      id: "files",
      title: "Files changed",
      content: !selectedPr ? (
        noPrSelected
      ) : (
        <Suspense fallback={<LoadingState />}>
          <PrFilesTab pr={selectedPr} threads={reviewQuery.data?.threads} />
        </Suspense>
      ),
      position: { relativeTo: "review", direction: "within" },
    },
    {
      id: "result",
      title: "Result",
      content: !selectedPr ? noPrSelected : <ResultTab selectedPr={selectedPr} />,
      position: { relativeTo: "review", direction: "within" },
    },
  ];

  return (
    <aside
      onKeyDown={handlePreviewKeyDown}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring"
    >
      {/* Persistent PR header (visible on every tab), GitHub-style. Reviewers
          (with required/optional + remove controls) render here too. */}
      <PrReviewHeader
        selectedPr={selectedPr}
        review={reviewQuery.data ?? null}
        maximized={maximized}
        onToggleMaximize={onToggleMaximize}
        reviewerActionsBusy={reviewerActionsBusy}
        onToggleReviewerRequired={(reviewer) => {
          if (!selectedPr || !reviewer.id) return;
          reviewerRequiredMutation.mutate({
            ...prLocator(selectedPr),
            reviewerId: reviewer.id,
            isRequired: !reviewer.isRequired,
          });
        }}
        onRemoveReviewer={(reviewer) => {
          if (!selectedPr || !reviewer.id) return;
          if (window.confirm(`Remove ${reviewer.displayName} as a reviewer?`)) {
            removeReviewerMutation.mutate({ ...prLocator(selectedPr), reviewerId: reviewer.id });
          }
        }}
        zoom={zoom}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
      />
      {reviewerError ? (
        <div className="shrink-0 border-b border-border bg-red-50 px-3 py-1 text-xs text-destructive dark:bg-red-950/40">
          {reviewerError}
        </div>
      ) : null}

      <div className="flex h-6 shrink-0 items-center justify-end gap-2 border-b border-border px-2">
        {reviewQuery.isFetching ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col" style={{ zoom }}>
        <DockableWorkspace storageKey="pr-review-panel" panels={panels} />
      </div>
    </aside>
  );
}
