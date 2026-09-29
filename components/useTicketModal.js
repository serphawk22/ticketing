'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ticketKey } from './meta';

const PARAM = 'selectedIssue';

function readParam() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(PARAM) || '';
}

function writeParam(value) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(PARAM, value);
  else url.searchParams.delete(PARAM);
  window.history.pushState({}, '', url);
}

/**
 * Keeps the open ticket in the URL so a view is shareable and survives a
 * refresh.
 *
 * `visible` is the list currently on screen; the previous/next chevrons walk
 * only that list. `lookup` is the full set, which is what resolves a key that
 * was reached from a linked work item and so is not part of the current
 * filter.
 */
export default function useTicketModal({ visible = [], lookup = [] } = {}) {
  const [selectedKey, setSelectedKey] = useState('');

  useEffect(() => {
    setSelectedKey(readParam());
    const onPop = () => setSelectedKey(readParam());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const index = useMemo(
    () => (selectedKey ? visible.findIndex((t) => ticketKey(t) === selectedKey) : -1),
    [visible, selectedKey]
  );

  // Only a key that resolves to nothing at all may drop the modal. A key that
  // merely fell out of the current filter keeps the issue open and keeps the
  // chevrons disabled until navigation brings it back into range.
  const known = useMemo(() => {
    if (!selectedKey) return true;
    return lookup.some((t) => ticketKey(t) === selectedKey);
  }, [lookup, selectedKey]);

  useEffect(() => {
    if (selectedKey && !known) {
      writeParam('');
      setSelectedKey('');
    }
  }, [selectedKey, known]);

  const select = useCallback((ticket) => {
    const key = ticket ? ticketKey(ticket) : '';
    writeParam(key);
    setSelectedKey(key);
  }, []);

  const selectByKey = useCallback((key) => {
    writeParam(key);
    setSelectedKey(key);
  }, []);

  const close = useCallback(() => {
    writeParam('');
    setSelectedKey('');
  }, []);

  const step = useCallback(
    (delta) => {
      if (index === -1 || visible.length < 2) return;
      const next = (index + delta + visible.length) % visible.length;
      select(visible[next]);
    },
    [index, visible, select]
  );

  const selected = useMemo(
    () => lookup.find((t) => ticketKey(t) === selectedKey) || null,
    [lookup, selectedKey]
  );

  return {
    selected,
    selectedKey,
    inRange: index !== -1,
    position: index === -1 ? null : { index: index, total: visible.length },
    select,
    selectByKey,
    close,
    next: () => step(1),
    prev: () => step(-1),
    canStep: index !== -1 && visible.length > 1,
  };
}
