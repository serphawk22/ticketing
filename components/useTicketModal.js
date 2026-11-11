'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ticketKey } from './meta';
import { parseTicketKey } from '../lib/ticketRefs';

const PARAM = 'selectedIssue';

function readParam() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(PARAM) || '';
}

function writeParam(value, { replace = false } = {}) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(PARAM, value);
  else url.searchParams.delete(PARAM);
  if (replace) {
    window.history.replaceState({}, '', url);
  } else {
    window.history.pushState({}, '', url);
  }
}

function normalizeKey(value) {
  const parsed = parseTicketKey(String(value || ''));
  return parsed ? parsed.key : String(value || '').trim().toUpperCase();
}

/**
 * Keeps the open ticket in the URL so a view is shareable and survives a
 * refresh.
 *
 * `visible` is the list currently on screen; the previous/next chevrons walk
 * only that list. `lookup` is the local set, and any key not found in `lookup`
 * is resolved on demand via `/api/tickets/by-key/[key]` (or by id via
 * `/api/tickets/[id]/detail`), enabling cross-project ticket opening.
 */
export default function useTicketModal({ visible = [], lookup = [] } = {}) {
  const [selectedKey, setSelectedKey] = useState('');
  const [remoteTickets, setRemoteTickets] = useState({});
  const [loadingKey, setLoadingKey] = useState('');
  const [lookupError, setLookupError] = useState('');

  const inFlightKeysRef = useRef(new Map());
  const inFlightIdsRef = useRef(new Map());
  const failedKeysRef = useRef(new Map());

  useEffect(() => {
    setSelectedKey(readParam());
    const onPop = () => {
      setLookupError('');
      setSelectedKey(readParam());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const normalizedSelectedKey = useMemo(
    () => (selectedKey ? normalizeKey(selectedKey) : ''),
    [selectedKey]
  );

  const index = useMemo(
    () =>
      normalizedSelectedKey
        ? visible.findIndex((t) => ticketKey(t).toUpperCase() === normalizedSelectedKey)
        : -1,
    [visible, normalizedSelectedKey]
  );

  const localSelected = useMemo(
    () =>
      normalizedSelectedKey
        ? lookup.find((t) => ticketKey(t).toUpperCase() === normalizedSelectedKey) || null
        : null,
    [lookup, normalizedSelectedKey]
  );

  const selected = useMemo(() => {
    if (!normalizedSelectedKey) return null;
    return localSelected || remoteTickets[normalizedSelectedKey] || null;
  }, [normalizedSelectedKey, localSelected, remoteTickets]);

  // Resolve any selectedKey missing from local `lookup` via `/api/tickets/by-key/[key]`.
  useEffect(() => {
    if (!normalizedSelectedKey || localSelected || remoteTickets[normalizedSelectedKey]) {
      setLoadingKey('');
      return undefined;
    }

    if (failedKeysRef.current.has(normalizedSelectedKey)) {
      setLookupError(failedKeysRef.current.get(normalizedSelectedKey));
      setLoadingKey('');
      writeParam('', { replace: true });
      setSelectedKey('');
      return undefined;
    }

    const parsed = parseTicketKey(normalizedSelectedKey);
    if (!parsed) {
      const msg = `Invalid ticket reference "${selectedKey}".`;
      failedKeysRef.current.set(normalizedSelectedKey, msg);
      setLookupError(msg);
      writeParam('', { replace: true });
      setSelectedKey('');
      return undefined;
    }

    let cancelled = false;
    setLoadingKey(parsed.key);
    setLookupError('');

    let promise = inFlightKeysRef.current.get(parsed.key);
    if (!promise) {
      promise = fetch(`/api/tickets/by-key/${encodeURIComponent(parsed.key)}`)
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data?.ticket) {
            throw new Error(data?.error || `Could not open ticket ${parsed.key}.`);
          }
          return data.ticket;
        })
        .finally(() => {
          inFlightKeysRef.current.delete(parsed.key);
        });
      inFlightKeysRef.current.set(parsed.key, promise);
    }

    promise
      .then((ticket) => {
        if (cancelled) return;
        const resolvedKey = ticketKey(ticket).toUpperCase();
        setRemoteTickets((prev) => ({ ...prev, [resolvedKey]: ticket }));
        setLoadingKey('');
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err?.message || `Ticket ${parsed.key} could not be opened.`;
        failedKeysRef.current.set(parsed.key, message);
        setLookupError(message);
        setLoadingKey('');
        writeParam('', { replace: true });
        setSelectedKey('');
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedSelectedKey, selectedKey, localSelected, remoteTickets]);

  const select = useCallback((ticket) => {
    const key = ticket ? ticketKey(ticket).toUpperCase() : '';
    setLookupError('');
    if (key) {
      failedKeysRef.current.delete(key);
      setRemoteTickets((prev) => (prev[key] ? prev : { ...prev, [key]: ticket }));
    }
    writeParam(key);
    setSelectedKey(key);
  }, []);

  const selectByKey = useCallback((key) => {
    const normalized = normalizeKey(key);
    setLookupError('');
    if (normalized) {
      failedKeysRef.current.delete(normalized);
    }
    writeParam(normalized);
    setSelectedKey(normalized);
  }, []);

  const selectById = useCallback(
    async (id) => {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || numericId <= 0) return;

      const fromLocal = lookup.find((t) => Number(t.id) === numericId);
      if (fromLocal) {
        select(fromLocal);
        return;
      }

      const fromRemote = Object.values(remoteTickets).find(
        (t) => Number(t.id) === numericId
      );
      if (fromRemote) {
        select(fromRemote);
        return;
      }

      setLookupError('');
      setLoadingKey(`#${numericId}`);

      let promise = inFlightIdsRef.current.get(numericId);
      if (!promise) {
        promise = fetch(`/api/tickets/${numericId}/detail`)
          .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.ticket) {
              throw new Error(data?.error || 'Ticket not found.');
            }
            return data.ticket;
          })
          .finally(() => {
            inFlightIdsRef.current.delete(numericId);
          });
        inFlightIdsRef.current.set(numericId, promise);
      }

      try {
        const ticket = await promise;
        select(ticket);
      } catch (err) {
        setLookupError(err?.message || 'Could not open ticket.');
      } finally {
        setLoadingKey('');
      }
    },
    [lookup, remoteTickets, select]
  );

  /**
   * Universal opener accepting a ticket object, a ticket key (`"TM-101"`),
   * or a numeric ticket id (`101`).
   */
  const open = useCallback(
    (target) => {
      if (!target) return;
      if (typeof target === 'object' && target.id != null) {
        select(target);
        return;
      }
      if (typeof target === 'number') {
        selectById(target);
        return;
      }
      const text = String(target).trim();
      if (/^\d+$/.test(text)) {
        selectById(Number(text));
        return;
      }
      const parsed = parseTicketKey(text);
      if (parsed) {
        const local = lookup.find((t) => ticketKey(t).toUpperCase() === parsed.key);
        if (local) {
          select(local);
        } else {
          selectByKey(parsed.key);
        }
      }
    },
    [lookup, select, selectById, selectByKey]
  );

  const close = useCallback(() => {
    setLookupError('');
    setLoadingKey('');
    writeParam('');
    setSelectedKey('');
  }, []);

  const clearLookupError = useCallback(() => {
    setLookupError('');
  }, []);

  const step = useCallback(
    (delta) => {
      if (index === -1 || visible.length < 2) return;
      const next = (index + delta + visible.length) % visible.length;
      select(visible[next]);
    },
    [index, visible, select]
  );

  return {
    selected,
    selectedKey: normalizedSelectedKey,
    loadingKey,
    lookupError,
    clearLookupError,
    inRange: index !== -1,
    position: index === -1 ? null : { index, total: visible.length },
    select,
    selectByKey,
    selectById,
    open,
    close,
    next: () => step(1),
    prev: () => step(-1),
    canStep: index !== -1 && visible.length > 1,
  };
}
