import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DockviewReact,
  DockviewDefaultTab,
  themeDark,
  themeVisualStudio,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { ResizeHandle } from "@/components/ResizeHandle";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { THEME_CHANGED_EVENT, watchSystemTheme } from "@/lib/theme";

const GRID_PANEL_ID = "grid";
const PREVIEW_PANEL_ID = "preview";

interface PanelContentParams {
  content: ReactNode;
}

function PanelContent(props: IDockviewPanelProps<PanelContentParams>) {
  return <>{props.params.content}</>;
}

const PANEL_COMPONENTS = { content: PanelContent };

/**
 * dockview's own resize sash is pointer-drag only (no keyboard path), which
 * would make the preview pane's width mouse-only. This renders a keyboard
 * operable resize control (same semantics as the app's other split panes)
 * into the preview panel's tab-bar header actions.
 */
function createPreviewResizeAction(options: { min: number; max: number; defaultWidth: number }) {
  return function PreviewResizeAction({ api, group }: IDockviewHeaderActionsProps) {
    const isPreviewGroup = group.panels.some((panel) => panel.id === PREVIEW_PANEL_ID);
    const [width, setWidth] = useState(() => api.width);

    useEffect(() => {
      const disposable = api.onDidDimensionsChange((event) => setWidth(event.width));
      return () => disposable.dispose();
    }, [api]);

    if (!isPreviewGroup) return null;

    return (
      <ResizeHandle
        ariaLabel="Resize preview"
        direction={-1}
        min={options.min}
        max={options.max}
        value={width}
        onChange={(next) => api.setSize({ width: next })}
        onReset={() => api.setSize({ width: options.defaultWidth })}
        className="flex h-5 w-4 shrink-0"
      />
    );
  };
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

function useIsDarkMode(): boolean {
  const [dark, setDark] = useState(isDarkMode);
  useEffect(() => {
    const update = () => setDark(isDarkMode());
    window.addEventListener(THEME_CHANGED_EVENT, update);
    const unwatch = watchSystemTheme(update);
    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, update);
      unwatch();
    };
  }, []);
  return dark;
}

/**
 * A dockable, resizable two-pane layout (grid | preview) built on dockview.
 * Panels can be dragged to rearrange, floated, or maximized like a
 * Visual Studio tool window; the resulting layout persists per `storageKey`.
 *
 * `grid`/`preview` are re-synced into the already-created panels on every
 * change (dockview only calls `onReady` once, at mount), so callers can pass
 * fresh JSX on every render the same way they would to a plain component.
 */
export function DockableSplit({
  storageKey,
  gridTitle,
  previewTitle,
  grid,
  preview,
  defaultPreviewWidth,
  minPreviewWidth,
  maxPreviewWidth,
  minGridWidth = 480,
  maximized = false,
}: {
  storageKey: string;
  gridTitle: string;
  previewTitle: string;
  grid: ReactNode;
  preview: ReactNode;
  defaultPreviewWidth: number;
  minPreviewWidth: number;
  maxPreviewWidth: number;
  minGridWidth?: number;
  /** Mirrors dockview's own group-maximize state under the app's existing maximize toggle/shortcut. */
  maximized?: boolean;
}) {
  const apiRef = useRef<DockviewApi | null>(null);
  const dark = useIsDarkMode();
  // Frozen at first render: dockview reads `rightHeaderActionsComponent` only
  // once, at mount, the same as `onReady` below.
  const rightHeaderActionsComponent = useRef(
    createPreviewResizeAction({
      min: minPreviewWidth,
      max: maxPreviewWidth,
      defaultWidth: defaultPreviewWidth,
    }),
  ).current;

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;

      const saved = readStoredJson<SerializedDockview | undefined>(
        storageKey,
        (raw) => raw as SerializedDockview,
        undefined,
      );

      let restored = false;
      if (saved) {
        try {
          api.fromJSON(saved);
          restored =
            api.getPanel(GRID_PANEL_ID) !== undefined && api.getPanel(PREVIEW_PANEL_ID) !== undefined;
        } catch {
          restored = false;
        }
      }

      if (restored) {
        // Size constraints (min/max width) are only applied at panel creation
        // below, not restored from the serialized layout; a saved layout keeps
        // whatever width the user last dragged it to.
        api.getPanel(GRID_PANEL_ID)?.api.updateParameters({ content: grid });
        api.getPanel(PREVIEW_PANEL_ID)?.api.updateParameters({ content: preview });
      } else {
        const gridPanel = api.addPanel<PanelContentParams>({
          id: GRID_PANEL_ID,
          component: "content",
          title: gridTitle,
          params: { content: grid },
          minimumWidth: minGridWidth,
        });
        api.addPanel<PanelContentParams>({
          id: PREVIEW_PANEL_ID,
          component: "content",
          title: previewTitle,
          params: { content: preview },
          position: { referencePanel: gridPanel.id, direction: "right" },
          initialWidth: defaultPreviewWidth,
          minimumWidth: minPreviewWidth,
          maximumWidth: maxPreviewWidth,
        });
      }

      // `onDidLayoutChange` covers structural changes (panels added/removed/
      // moved) but not a pure size change from the keyboard-resize action
      // below, so persist on the group's dimension changes too (the group
      // API reflects dockview's own layout-engine bookkeeping directly; the
      // panel-level equivalent depends on a ResizeObserver on its content
      // element, which won't fire in a test environment without real DOM
      // measurement).
      const persist = () => writeStoredJson(storageKey, api.toJSON());
      api.onDidLayoutChange(persist);
      api.getPanel(GRID_PANEL_ID)?.api.group.api.onDidDimensionsChange(persist);
      api.getPanel(PREVIEW_PANEL_ID)?.api.group.api.onDidDimensionsChange(persist);
    },
    // Mount-only: dockview calls onReady exactly once when the instance is
    // created. Later `grid`/`preview` changes are pushed via the effects
    // below instead of re-running this setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey],
  );

  useEffect(() => {
    apiRef.current?.getPanel(GRID_PANEL_ID)?.api.updateParameters({ content: grid });
  }, [grid]);

  useEffect(() => {
    apiRef.current?.getPanel(PREVIEW_PANEL_ID)?.api.updateParameters({ content: preview });
  }, [preview]);

  useEffect(() => {
    const api = apiRef.current;
    const previewPanel = api?.getPanel(PREVIEW_PANEL_ID);
    if (!api || !previewPanel) return;
    if (maximized) {
      api.maximizeGroup(previewPanel);
    } else if (api.hasMaximizedGroup()) {
      api.exitMaximizedGroup();
    }
  }, [maximized]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <DockviewReact
        className={dark ? "dockview-theme-dark" : "dockview-theme-vs"}
        components={PANEL_COMPONENTS}
        defaultTabComponent={(props) => <DockviewDefaultTab {...props} hideClose />}
        rightHeaderActionsComponent={rightHeaderActionsComponent}
        onReady={onReady}
        theme={dark ? themeDark : themeVisualStudio}
      />
    </div>
  );
}
