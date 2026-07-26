'use client';

import { useCallback, useEffect, useMemo, useReducer } from 'react';

type SelectionAction =
  | { type: 'toggle'; id: string }
  | { type: 'select-visible'; ids: readonly string[] }
  | { type: 'deselect-visible'; ids: readonly string[] }
  | { type: 'reconcile-visible'; ids: readonly string[] }
  | { type: 'remove'; ids: readonly string[] }
  | { type: 'clear' };

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function selectionReducer(selectedIds: Set<string>, action: SelectionAction): Set<string> {
  switch (action.type) {
    case 'toggle': {
      const next = new Set(selectedIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return next;
    }
    case 'select-visible':
      return new Set([...selectedIds, ...action.ids]);
    case 'deselect-visible':
    case 'remove': {
      const removedIds = new Set(action.ids);
      const next = new Set([...selectedIds].filter((id) => !removedIds.has(id)));
      return setsEqual(selectedIds, next) ? selectedIds : next;
    }
    case 'reconcile-visible': {
      const visibleIds = new Set(action.ids);
      const next = new Set([...selectedIds].filter((id) => visibleIds.has(id)));
      return setsEqual(selectedIds, next) ? selectedIds : next;
    }
    case 'clear':
      return selectedIds.size === 0 ? selectedIds : new Set();
  }
}

/**
 * Keeps list selection scoped to the current visible result snapshot.
 * Hidden, refreshed, deleted, and non-list IDs are removed before callers can act on them.
 */
export function useVisibleLeadSelection(visibleLeadIds: readonly string[], enabled: boolean) {
  const [storedSelectedIds, dispatch] = useReducer(selectionReducer, new Set<string>());
  const selectableIds = useMemo(
    () => (enabled ? visibleLeadIds : ([] as readonly string[])),
    [enabled, visibleLeadIds]
  );
  const selectableIdSet = useMemo(() => new Set(selectableIds), [selectableIds]);

  const selectedIds = useMemo(
    () => new Set([...storedSelectedIds].filter((id) => selectableIdSet.has(id))),
    [selectableIdSet, storedSelectedIds]
  );

  useEffect(() => {
    dispatch({ type: 'reconcile-visible', ids: selectableIds });
  }, [selectableIds]);

  const toggle = useCallback(
    (id: string) => {
      if (selectableIdSet.has(id)) dispatch({ type: 'toggle', id });
    },
    [selectableIdSet]
  );
  const selectAllVisible = useCallback(
    () => dispatch({ type: 'select-visible', ids: selectableIds }),
    [selectableIds]
  );
  const deselectVisible = useCallback(
    () => dispatch({ type: 'deselect-visible', ids: selectableIds }),
    [selectableIds]
  );
  const clearAll = useCallback(() => dispatch({ type: 'clear' }), []);
  const removeIds = useCallback((ids: readonly string[]) => dispatch({ type: 'remove', ids }), []);

  return useMemo(
    () => ({ selectedIds, toggle, selectAllVisible, deselectVisible, clearAll, removeIds }),
    [clearAll, deselectVisible, removeIds, selectAllVisible, selectedIds, toggle]
  );
}
