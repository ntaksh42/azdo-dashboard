import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  commandErrorMessage,
  getAppSettings,
  getWorkItemResultPreview,
} from "@/lib/azdoCommands";
import { openLocalPath } from "@/lib/openExternal";
import { LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { PreviewSection } from "./PreviewSection";

// Mirrors the PR "Result" tab (PrSecondaryTabs.tsx), matching a locally
// generated HTML report by work item id instead of PR id.
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

  if (!hasFolder) return null;
  if (settingsQuery.isLoading || previewQuery.isLoading) {
    return (
      <PreviewSection collapseId="reviewResult" title="Review result">
        <LoadingState />
      </PreviewSection>
    );
  }
  if (previewQuery.isError) {
    return (
      <PreviewSection collapseId="reviewResult" title="Review result">
        <p className="text-[11px] leading-4 text-destructive">
          {commandErrorMessage(previewQuery.error)}
        </p>
      </PreviewSection>
    );
  }
  if (!preview) {
    return (
      <PreviewSection collapseId="reviewResult" title="Review result">
        <PreviewEmptyState message={`No HTML file matched work item ${workItemId}.`} />
      </PreviewSection>
    );
  }

  return (
    <PreviewSection collapseId="reviewResult" title="Review result">
      <div className="flex items-center gap-2 pb-1">
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
        className="h-64 w-full rounded border border-border bg-card outline-none"
      />
    </PreviewSection>
  );
}
