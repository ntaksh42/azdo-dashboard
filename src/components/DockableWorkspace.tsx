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
import { useIsDarkMode } from "@/lib/useIsDarkMode";

export interface DockablePanelSpec {
  id: string;
  title: string;
  content: ReactNode;
  /**
   * Where to place this panel when the layout is first built (ignored once a
   * layout has been persisted and is restored instead). Omit for the anchor
   * panel -- the first panel with no `position` becomes the root everything
   * else is placed relative to. `"within"` adds this panel as a tab in the
   * reference panel's own group rather than splitting off new space -- the
   * right default for something the user can drag into its own pane later,
   * since a `"left"`/`"right"`/`"above"`/`"below"` split carves its
   * `initialWidth` directly out of the *referenced* panel's own space (not
   * the row's free space), which can force that panel down to its floor.
   */
  position?: { relativeTo: string; direction: "left" | "right" | "above" | "below" | "within" };
  /** Width in pixels when this panel is first split out. Ignored for `"within"`. */
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

interface PanelContentParams {
  content: ReactNode;
}

function PanelContent(props: IDockviewPanelProps<PanelContentParams>) {
  return <>{props.params.content}</>;
}

const PANEL_COMPONENTS = { content: PanelContent };

/**
 * dockview's own resize sash is pointer-drag only (no keyboard path). This
 * renders a keyboard-operable resize control (same semantics as the app's
 * other split panes) into the header actions of any panel that was given a
 * `minWidth`/`maxWidth` -- i.e. every panel except the anchor.
 */
function createPanelResizeAction(
  specs: Map<string, { min: number; max: number; defaultWidth: number; title: string }>,
) {
  return function PanelResizeAction({ api, group }: IDockviewHeaderActionsProps) {
    const resizablePanel = group.panels.find((panel) => specs.has(panel.id));
    const [width, setWidth] = useState(() => api.width);

    useEffect(() => {
      const disposable = api.onDidDimensionsChange((event) => setWidth(event.width));
      return () => disposable.dispose();
    }, [api]);

    if (!resizablePanel) return null;
    const spec = specs.get(resizablePanel.id);
    if (!spec) return null;

    return (
      <ResizeHandle
        ariaLabel={`Resize ${spec.title}`}
        direction={-1}
        min={spec.min}
        max={spec.max}
        value={width}
        onChange={(next) => api.setSize({ width: next })}
        onReset={() => api.setSize({ width: spec.defaultWidth })}
        className="flex h-5 w-4 shrink-0"
      />
    );
  };
}

/**
 * A dockable workspace of named panels built on dockview: panels can be
 * dragged into tab groups together, split side by side, floated, or
 * maximized like Visual Studio tool windows. The resulting arrangement
 * persists per `storageKey`.
 *
 * `panels` is re-synced into the already-created dockview panels on every
 * render (dockview only calls `onReady` once, at mount), so callers can pass
 * fresh JSX for each panel's `content` the same way they would to a plain
 * component. Adding or removing an entry from `panels` across renders is not
 * supported -- the panel set is fixed at mount (from the first render's
 * value); only each panel's own `content` is expected to change over time.
 */
export function DockableWorkspace({
  storageKey,
  panels,
  maximizedId,
  activatePanel,
}: {
  storageKey: string;
  panels: DockablePanelSpec[];
  /** Id of the panel to show maximized, or undefined to show the normal layout. */
  maximizedId?: string;
  /**
   * Imperatively bring a panel's tab to the front -- e.g. after an action
   * that should jump the user to a specific pane even if they had manually
   * switched to a different tab in the same group. Bump `key` to re-trigger
   * activating the same `id` again (a plain `id` string wouldn't re-run the
   * effect on a second identical activation).
   */
  activatePanel?: { id: string; key: number };
}) {
  const apiRef = useRef<DockviewApi | null>(null);
  const dark = useIsDarkMode();
  const panelsRef = useRef(panels);
  panelsRef.current = panels;

  // Frozen at first render: dockview reads `rightHeaderActionsComponent` only
  // once, at mount, the same as `onReady` below.
  const rightHeaderActionsComponent = useRef(
    createPanelResizeAction(
      new Map(
        panels
          .filter((panel) => panel.position && panel.minWidth !== undefined && panel.maxWidth !== undefined)
          .map((panel) => [
            panel.id,
            {
              min: panel.minWidth!,
              max: panel.maxWidth!,
              defaultWidth: panel.initialWidth ?? panel.minWidth!,
              title: panel.title,
            },
          ]),
      ),
    ),
  ).current;

  function syncPanelContent() {
    const api = apiRef.current;
    if (!api) return;
    for (const spec of panelsRef.current) {
      api.getPanel(spec.id)?.api.updateParameters({ content: spec.content });
    }
  }

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;
      const initialPanels = panelsRef.current;

      const saved = readStoredJson<SerializedDockview | undefined>(
        storageKey,
        (raw) => raw as SerializedDockview,
        undefined,
      );

      let restored = false;
      if (saved) {
        try {
          api.fromJSON(saved);
          restored = initialPanels.every((spec) => api.getPanel(spec.id) !== undefined);
        } catch {
          restored = false;
        }
      }

      if (restored) {
        // Size constraints (min/max width) are only applied at panel creation
        // below, not restored from the serialized layout; a saved layout keeps
        // whatever arrangement the user last left it in.
        syncPanelContent();
      } else {
        for (const spec of initialPanels) {
          api.addPanel<PanelContentParams>({
            id: spec.id,
            component: "content",
            title: spec.title,
            params: { content: spec.content },
            minimumWidth: spec.minWidth,
            maximumWidth: spec.position ? spec.maxWidth : undefined,
            // Adding a panel activates it by default, which would steal
            // focus from whatever tab the user (or the caller's default
            // arrangement) already had showing in that group -- only a
            // freshly split-off panel (its own new group) should become
            // active; one joining an existing group as a tab should not.
            inactive: spec.position?.direction === "within",
            ...(spec.position
              ? {
                  position: { referencePanel: spec.position.relativeTo, direction: spec.position.direction },
                  initialWidth: spec.initialWidth,
                }
              : {}),
          });
        }
      }

      // `onDidLayoutChange` covers structural changes (panels added/removed/
      // moved) but not a pure size change from the keyboard-resize action
      // above, so persist on each group's dimension changes too (the group
      // API reflects dockview's own layout-engine bookkeeping directly; the
      // panel-level equivalent depends on a ResizeObserver on its content
      // element, which won't fire in a test environment without real DOM
      // measurement).
      //
      // `toJSON()` embeds each panel's `params`, which is the React element
      // passed as `content` -- that survives one JSON round-trip as a plain
      // object (not a real element), so restoring it later would crash
      // React. Strip params before persisting; content is always re-supplied
      // via `updateParameters` on restore anyway.
      const persist = () => {
        const layout = api.toJSON();
        for (const panel of Object.values(layout.panels)) {
          panel.params = undefined;
        }
        writeStoredJson(storageKey, layout);
      };
      api.onDidLayoutChange(persist);
      for (const spec of initialPanels) {
        api.getPanel(spec.id)?.api.group.api.onDidDimensionsChange(persist);
      }
    },
    // Mount-only: dockview calls onReady exactly once when the instance is
    // created. Later `panels` changes are pushed via the effect below instead
    // of re-running this setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey],
  );

  useEffect(() => {
    syncPanelContent();
  });

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const panel = maximizedId ? api.getPanel(maximizedId) : undefined;
    if (panel) {
      api.maximizeGroup(panel);
    } else if (api.hasMaximizedGroup()) {
      api.exitMaximizedGroup();
    }
  }, [maximizedId]);

  useEffect(() => {
    if (!activatePanel) return;
    apiRef.current?.getPanel(activatePanel.id)?.api.setActive();
    // `key` (not just `id`) is the trigger: activating the same id again
    // needs a bumped key to re-run this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activatePanel?.id, activatePanel?.key]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <DockviewReact
        className={dark ? "dockview-theme-dark" : "dockview-theme-vs"}
        components={PANEL_COMPONENTS}
        defaultTabComponent={(props) => <DockviewDefaultTab {...props} hideClose />}
        // A background tab (stacked behind the active one in the same group)
        // unmounts, so a panel's own queries/effects only run while it's
        // actually visible -- important once panels tab together instead of
        // each always being its own separate, always-visible split. Panels
        // genuinely visible side by side in different groups stay mounted.
        defaultRenderer="onlyWhenVisible"
        rightHeaderActionsComponent={rightHeaderActionsComponent}
        onReady={onReady}
        theme={dark ? themeDark : themeVisualStudio}
      />
    </div>
  );
}
