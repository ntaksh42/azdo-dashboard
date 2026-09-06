import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  commandErrorMessage,
  getAppSettings,
  getWorkItemResultPreview,
} from "@/lib/azdoCommands";
import { openLocalPath } from "@/lib/openExternal";
import { LoadingState, PreviewEmptyState } from "@/components/StateDisplay";

// Mirrors the PR "Result" tab (PrSecondaryTabs.tsx), matching a locally
// generated HTML report by work item id instead of PR id. Rendered as its own
// dockable panel (see WorkItemsGrid.tsx) rather than a section embedded in
// the main preview, so it fills the height it's given instead of a fixed
// scroll box.
export function WorkItemResultSection({ workItemId }: { workItemId: number }) {
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });

  const hasFolder = !!settingsQuery.data?.workItemResultFolderPath;

  const previewQuery = useQuery({
    queryKey: ["workItemResultPreview", workItemId],
    queryFn: () => getWorkItemResultPreview({ workItemId }),
    enabled: hasFolder,
  });

  const preview = previewQuery.data ?? null;

  function openInBrowser() {
    if (!preview) return;
    void openLocalPath(preview.filePath);
  }

  if (!hasFolder) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <PreviewEmptyState message="Set a work item result folder in Settings to see investigation output here." />
      </div>
    );
  }
  if (settingsQuery.isLoading || previewQuery.isLoading) {
    return (
      <div className="p-3">
        <LoadingState />
      </div>
    );
  }
  if (previewQuery.isError) {
    return (
      <p className="p-3 text-[11px] leading-4 text-destructive">
        {commandErrorMessage(previewQuery.error)}
      </p>
    );
  }
  if (!preview) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <PreviewEmptyState message={`No HTML file matched work item ${workItemId}.`} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={preview.fileName}>
            {preview.fileName}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={preview.filePath}>
            {preview.filePath}
          </p>
        </div>
        <button
          type="button"
          onClick={openInBrowser}
          title="Open the review result in your browser"
          className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Open in browser
        </button>
      </div>
      {/* `allow-same-origin` (without `allow-scripts`) is required for the
          WebView2 desktop runtime to render a `srcDoc` document at all;
          mirrors the PR review-result iframe in PrSecondaryTabs.tsx. */}
      <iframe
        title={`Review result preview for work item ${preview.workItemId}`}
        sandbox="allow-same-origin"
        srcDoc={preview.html}
        className="min-h-0 flex-1 rounded border border-border bg-card outline-none"
      />
    </div>
  );
}
