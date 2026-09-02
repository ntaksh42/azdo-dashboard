import { memo, useCallback } from 'react';
import { type PullRequestSummary } from '@/lib/azdoCommands';
import { PrSearchRow } from './PrSearchRow';
import { type PrSearchColumnKey } from './PrSearchTypes';

// One virtualized row. Memoized so that moving the selection, typing in the
// filter box, or a background sync only re-renders the rows whose own props
// changed instead of every visible row. The ref and click callbacks are built
// here (not in the parent's map) so they stay stable per row.
export const MemoPrSearchRow = memo(function MemoPrSearchRow({
  index,
  pr,
  selected,
  inMultiSelection,
  columnTemplate,
  visibleColumns,
  rowRefs,
  handleRowClick,
  setSelectedIndex,
}: {
  index: number;
  pr: PullRequestSummary;
  selected: boolean;
  inMultiSelection: boolean;
  columnTemplate: string;
  visibleColumns: PrSearchColumnKey[];
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
    (modifiers: { shiftKey: boolean; ctrlKey: boolean }) => {
      handleRowClick(index, modifiers, setSelectedIndex);
    },
    [index, handleRowClick, setSelectedIndex],
  );

  return (
    <PrSearchRow
      ref={setRef}
      pr={pr}
      selected={selected}
      inMultiSelection={inMultiSelection}
      columnTemplate={columnTemplate}
      visibleColumns={visibleColumns}
      onSelect={onSelect}
    />
  );
});
