import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DockviewReact,
  DockviewDefaultTab,
  themeDark,
  themeVisualStudio,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import type { UseQueryResult } from "@tanstack/react-query";
import { commandErrorMessage, type Organization } from "@/lib/azdoCommands";
import { LoadingState, ErrorState } from "@/components/StateDisplay";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { useIsDarkMode } from "@/lib/useIsDarkMode";
import { MyReviewsGrid } from "@/features/pull-requests/MyReviewsGrid";
import type { MyReviewsSelectRequest } from "@/features/pull-requests/MyReviewsGrid";
import type { WorkItemQueryView } from "@/features/work-items/workItemViewsStorage";
import {
  CommitSearch,
  PipelinesView,
  CodeBrowseView,
  WorkItemSearch,
  WorkItemViewsPanel,
  MyWorkItemsPanel,
  OrganizationSettings,
  SetupPanel,
  PullRequestSearch,
  MyPullRequestsGrid,
  AnalyzeView,
  CrossOrgSummaryView,
  NotificationsView,
} from "./lazyViews";
import type { View, ExternalSearchRequest } from "./types";

const LAYOUT_STORAGE_KEY = "azdodeck:layout:appDock:v1";

const VIEW_TITLES: Record<View, string> = {
  pullRequestSearch: "Pull Requests",
  myReviews: "My Reviews",
  myPullRequests: "My Pull Requests",
  workItems: "Work Items",
  myWorkItems: "My Work Items",
  workItemViews: "Work Item Views",
  commits: "Commits",
  pipelines: "Pipelines",
  codeSearch: "Code",
  notifications: "Notifications",
  crossOrgSummary: "Cross-org summary",
  analyze: "Analyze",
  settings: "Settings",
};

interface PanelContentParams {
  content: ReactNode;
}

// Each panel's lazy view chunk should suspend independently -- a single
// Suspense boundary around the whole dockview instance would hide every
// already-open panel behind the fallback while a newly opened one loads.
//
// The wrapper is stamped `data-active-view-panel` only while this panel is
// the active one. With multiple views potentially docked open at once, global
// helpers like `focusPrimaryGrid()` (src/lib/utils.ts) scope their
// `document.querySelector` search to this marker first so a shortcut always
// targets the panel the user is actually looking at.
function PanelContent({ api, params }: IDockviewPanelProps<PanelContentParams>) {
  const [isActive, setIsActive] = useState(api.isActive);
  useEffect(() => {
    const disposable = api.onDidActiveChange((event) => setIsActive(event.isActive));
    return () => disposable.dispose();
  }, [api]);

  return (
    <div
      data-active-view-panel={isActive ? "true" : undefined}
      className="flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      <Suspense fallback={<LoadingState />}>{params.content}</Suspense>
    </div>
  );
}

const PANEL_COMPONENTS = { content: PanelContent };

export interface AppContentProps {
  activeView: View;
  onActiveViewChange: (view: View) => void;
  organizations: Organization[];
  organizationsQuery: Pick<UseQueryResult, "isLoading" | "isError" | "error" | "refetch">;
  pullRequestSearchRequest: ExternalSearchRequest | null;
  workItemSearchRequest: ExternalSearchRequest | null;
  commitSearchRequest: ExternalSearchRequest | null;
  myReviewsSelectRequest: MyReviewsSelectRequest | null;
  selectedWorkItemViewRequestId: string | null;
  onPullRequestSearchHandled: () => void;
  onWorkItemSearchHandled: () => void;
  onCommitSearchHandled: () => void;
  onMyReviewsSelectHandled: () => void;
  onSelectedViewChange: (id: string | null) => void;
  onSelectedViewRequestHandled: () => void;
  onWorkItemNavViewsChange: (views: WorkItemQueryView[]) => void;
  onOpenSettings: () => void;
  onOpenPullRequest: (query: string, organizationId?: string) => void;
  onOpenView: (view: "pipelines" | "settings" | "myReviews" | "myWorkItems") => void;
}

// One instance of each view can be open at a time -- clicking a sidebar entry
// for a view that's already docked focuses it rather than opening a second
// copy. `content` is built fresh from current props on every render and
// pushed into whichever panels are open via `updateParameters`.
function renderViewContent(view: View, props: AppContentProps): ReactNode {
  switch (view) {
    case "pullRequestSearch":
      return (
        <PullRequestSearch
          externalSearch={props.pullRequestSearchRequest}
          onExternalSearchHandled={props.onPullRequestSearchHandled}
        />
      );
    case "myReviews":
      return (
        <MyReviewsGrid
          selectRequest={props.myReviewsSelectRequest}
          onSelectRequestHandled={props.onMyReviewsSelectHandled}
        />
      );
    case "myPullRequests":
      return <MyPullRequestsGrid />;
    case "workItems":
      return (
        <WorkItemSearch
          externalSearch={props.workItemSearchRequest}
          onExternalSearchHandled={props.onWorkItemSearchHandled}
        />
      );
    case "myWorkItems":
      return <MyWorkItemsPanel />;
    case "workItemViews":
      return (
        <WorkItemViewsPanel
          selectedViewRequestId={props.selectedWorkItemViewRequestId}
          onSelectedViewChange={props.onSelectedViewChange}
          onSelectedViewRequestHandled={props.onSelectedViewRequestHandled}
          onViewsChange={props.onWorkItemNavViewsChange}
        />
      );
    case "commits":
      return (
        <CommitSearch
          externalSearch={props.commitSearchRequest}
          onExternalSearchHandled={props.onCommitSearchHandled}
          onOpenPullRequest={props.onOpenPullRequest}
        />
      );
    case "pipelines":
      return <PipelinesView />;
    case "codeSearch":
      return <CodeBrowseView />;
    case "notifications":
      return <NotificationsView onOpenPullRequest={props.onOpenPullRequest} onOpenView={props.onOpenView} />;
    case "crossOrgSummary":
      return <CrossOrgSummaryView onOpenView={props.onOpenView} />;
    case "analyze":
      return <AnalyzeView />;
    case "settings":
      return props.organizations.length === 0 ? (
        <SetupPanel />
      ) : (
        <OrganizationSettings organizations={props.organizations} />
      );
    default:
      return null;
  }
}

export function AppContent(props: AppContentProps) {
  const { activeView, onActiveViewChange, organizationsQuery, onOpenSettings } = props;
  const apiRef = useRef<DockviewApi | null>(null);
  const dark = useIsDarkMode();
  // Guards the reverse sync effect below from re-opening the panel it was
  // itself just told about via onDidActivePanelChange.
  const lastKnownActiveRef = useRef<View | null>(null);
  // `onReady` (below) is memoized once and only actually fires once the
  // organizations query settles and this component mounts <DockviewReact> for
  // the first time -- by which point `activeView` may already have changed
  // from its value at the moment that closure was created (e.g. the "zero
  // orgs" fallback in App.tsx is true before the query resolves, then flips
  // once real organizations load). Read the latest value through a ref so the
  // mount-time open picks the view actually current when dockview is ready.
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;

  const openOrFocusView = useCallback((view: View) => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel(view);
    if (existing) {
      existing.api.setActive();
    } else {
      api.addPanel<PanelContentParams>({
        id: view,
        component: "content",
        title: VIEW_TITLES[view],
        params: { content: null },
      });
    }
  }, []);

  // Deliberately not memoized: it must close over the current `props` on
  // every call, and is only ever invoked from the effect right below it.
  function syncPanelContent(): void {
    const api = apiRef.current;
    if (!api) return;
    for (const panel of api.panels) {
      const view = panel.id as View;
      panel.api.updateParameters({ content: renderViewContent(view, props) });
    }
  }

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;

      const saved = readStoredJson<SerializedDockview | undefined>(
        LAYOUT_STORAGE_KEY,
        (raw) => raw as SerializedDockview,
        undefined,
      );

      let restoredActive: View | null = null;
      if (saved) {
        try {
          api.fromJSON(saved);
          restoredActive = (api.activePanel?.id as View | undefined) ?? null;
        } catch {
          restoredActive = null;
        }
      }

      const initialView = activeViewRef.current;
      if (restoredActive) {
        lastKnownActiveRef.current = restoredActive;
        if (restoredActive !== initialView) onActiveViewChange(restoredActive);
      } else {
        openOrFocusView(initialView);
        lastKnownActiveRef.current = initialView;
      }
      syncPanelContent();

      api.onDidLayoutChange(() => {
        const layout = api.toJSON();
        for (const panel of Object.values(layout.panels)) {
          panel.params = undefined;
        }
        writeStoredJson(LAYOUT_STORAGE_KEY, layout);
      });
      api.onDidActivePanelChange((activePanelEvent) => {
        const view = activePanelEvent.panel?.id as View | undefined;
        if (!view || view === lastKnownActiveRef.current) return;
        lastKnownActiveRef.current = view;
        onActiveViewChange(view);
      });
    },
    // Mount-only setup; `activeView` here is only the initial value, later
    // changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Opens (or focuses) whichever view the rest of the app asked to navigate
  // to. Guarded against re-triggering from the panel-activation event above.
  useEffect(() => {
    if (!apiRef.current) return;
    if (activeView === lastKnownActiveRef.current) return;
    lastKnownActiveRef.current = activeView;
    openOrFocusView(activeView);
  }, [activeView, openOrFocusView]);

  useEffect(() => {
    syncPanelContent();
  });

  if (organizationsQuery.isLoading) {
    return (
      <section className="flex min-h-0 flex-1 flex-col overflow-auto px-3 py-3 lg:px-5">
        <LoadingState />
      </section>
    );
  }
  if (organizationsQuery.isError) {
    return (
      <section className="flex min-h-0 flex-1 flex-col overflow-auto px-3 py-3 lg:px-5">
        <ErrorState
          message={commandErrorMessage(organizationsQuery.error)}
          onRetry={() => void organizationsQuery.refetch()}
          onOpenSettings={onOpenSettings}
        />
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3 lg:px-5">
      <DockviewReact
        className={dark ? "dockview-theme-dark" : "dockview-theme-vs"}
        components={PANEL_COMPONENTS}
        defaultTabComponent={(tabProps) => <DockviewDefaultTab {...tabProps} />}
        // A background tab (stacked behind the active one in the same group)
        // unmounts, matching the single-active-view behavior every view
        // component was built around (no live queries or DOM markers left
        // behind once you switch away). Panels that are genuinely visible
        // side by side in different groups still stay mounted.
        defaultRenderer="onlyWhenVisible"
        onReady={onReady}
        theme={dark ? themeDark : themeVisualStudio}
      />
    </section>
  );
}
