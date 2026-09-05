import { useEffect, useState } from "react";
import { THEME_CHANGED_EVENT, watchSystemTheme } from "@/lib/theme";

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** Tracks the app's dark/light class on `<html>`, reacting to preference changes. */
export function useIsDarkMode(): boolean {
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
