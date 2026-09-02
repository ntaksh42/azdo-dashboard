import { useCallback, useEffect, useState } from "react";
import { clamp, storedNumber } from "@/lib/utils";

const STORAGE_KEY = "azdodeck:view:previewZoom:v1";
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.6;
const DEFAULT_ZOOM = 1;
const ZOOM_STEP = 0.1;

// Shared across every preview panel (work items, PRs, commits) so zooming in
// one view keeps that scale when switching to another.
export function usePreviewZoom() {
  const [zoom, setZoom] = useState(() => storedNumber(STORAGE_KEY, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM));

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(zoom));
  }, [zoom]);

  const zoomIn = useCallback(() => {
    setZoom((current) => clamp(Math.round((current + ZOOM_STEP) * 100) / 100, MIN_ZOOM, MAX_ZOOM));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((current) => clamp(Math.round((current - ZOOM_STEP) * 100) / 100, MIN_ZOOM, MAX_ZOOM));
  }, []);

  const resetZoom = useCallback(() => setZoom(DEFAULT_ZOOM), []);

  return {
    canZoomIn: zoom < MAX_ZOOM,
    canZoomOut: zoom > MIN_ZOOM,
    resetZoom,
    zoom,
    zoomIn,
    zoomOut,
  };
}
