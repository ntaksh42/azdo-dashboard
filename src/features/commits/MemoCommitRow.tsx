import { memo, useCallback } from "react";
import { type CommitSummary } from "@/lib/azdoCommands";
import { type CommitColumnKey } from "./commitSearchConstants";
import { CommitGridRow } from "./CommitGridRow";

// One virtualized row. Memoized so that moving the selection, typing in the
// filter box, or a background sync only re-renders the rows whose own props
// changed instead of every visible row. The `ref`/`onSelect` callbacks are
// built here (not in the parent's map) so they stay stable per row.
export const MemoCommitRow = memo(function MemoCommitRow({
  index,
  commit,
  selected,
  inMultiSelection,
  columnTemplate,
  visibleColumns,
  rowRefs,
  handleRowClick,
  setSelectedIndex,
}: {
  index: number;
  commit: CommitSummary;
  selected: boolean;
  inMultiSelection: boolean;
  columnTemplate: string;
  visibleColumns: CommitColumnKey[];
  rowRefs: React.RefObject<(HTMLDivElement | null)[]>;
  handleRowClick: (
    index: number,
    modifiers: { shiftKey: boolean; ctrlKey: boolean },
    setSelectedIndex: (index: number) => void,
  ) => void;
  setSelectedIndex: (index: number) => void;
}) {
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      rowRefs.current[index] = el;
    },
    [rowRefs, index],
  );

  const onSelect = useCallback(
    (modifiers: { shiftKey: boolean; ctrlKey: boolean }) =>
      handleRowClick(index, modifiers, setSelectedIndex),
    [index, handleRowClick, setSelectedIndex],
  );

  return (
    <CommitGridRow
      ref={setRef}
      commit={commit}
      selected={selected}
      inMultiSelection={inMultiSelection}
      columnTemplate={columnTemplate}
      visibleColumns={visibleColumns}
      onSelect={onSelect}
    />
  );
});
