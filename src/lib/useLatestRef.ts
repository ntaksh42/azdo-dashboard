import { useRef } from "react";

// Keeps a ref pointing at the latest value, refreshed on every render. Used so
// a useCallback with an empty dependency array can still read current values
// (state, derived data) without capturing them in its closure — the callback
// stays referentially stable across renders (needed for React.memo'd children)
// while still seeing up-to-date data at call time.
export function useLatestRef<T>(value: T): React.RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
