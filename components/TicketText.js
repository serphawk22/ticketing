'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  buildExistingKeySet,
  extractCandidateTicketKeys,
  ticketHref,
  tokenizeTicketRefs,
} from '../lib/ticketRefs';

// Module-level validation cache shared across components so multiple
// TicketText instances do not issue duplicate batch lookups.
const validatedKeyCache = new Map();
let pendingKeys = new Set();
let flushTimer = null;
let flushWaiters = [];

function scheduleBatchValidation(keys) {
  for (const key of keys) {
    if (!validatedKeyCache.has(key)) {
      pendingKeys.add(key);
    }
  }
  if (pendingKeys.size === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    flushWaiters.push(resolve);
    if (flushTimer) return;

    flushTimer = setTimeout(async () => {
      const batch = [...pendingKeys];
      const waiters = flushWaiters;
      pendingKeys = new Set();
      flushWaiters = [];
      flushTimer = null;

      try {
        for (let i = 0; i < batch.length; i += 50) {
          const chunk = batch.slice(i, i + 50);
          const res = await fetch(
            `/api/tickets/by-key?keys=${encodeURIComponent(chunk.join(','))}`
          );
          if (!res.ok) continue;
          const data = await res.json().catch(() => ({}));
          const valid = new Set(
            (data.validKeys || []).map((k) => String(k).toUpperCase())
          );
          for (const key of chunk) {
            validatedKeyCache.set(key, valid.has(key));
          }
        }
      } catch {
        // Leave unresolved keys unlinked on transient network errors.
      } finally {
        for (const w of waiters) w();
      }
    }, 20);
  });
}

/**
 * Imperatively validates candidate keys using `existingKeys` + the shared
 * `/api/tickets/by-key?keys=...` cache. Used by DOM editors like `DocEditor`.
 */
export async function validateTicketKeys(candidateKeys, existingKeys = null) {
  const localSet = existingKeys ? buildExistingKeySet(existingKeys) : new Set();
  const missing = [];

  for (const raw of candidateKeys || []) {
    const upper = String(raw || '').toUpperCase();
    if (!upper) continue;
    if (localSet.has(upper)) continue;
    if (validatedKeyCache.has(upper)) continue;
    missing.push(upper);
  }

  if (missing.length > 0) {
    await scheduleBatchValidation(missing);
  }

  const result = new Set(localSet);
  for (const raw of candidateKeys || []) {
    const upper = String(raw || '').toUpperCase();
    if (validatedKeyCache.get(upper) === true) {
      result.add(upper);
    }
  }
  return result;
}

/**
 * Resolves a validated Set of existing ticket keys for the supplied candidate
 * keys, reusing `existingKeys` where provided and validating remaining
 * candidates via `/api/tickets/by-key?keys=...`.
 */
export function useValidatedTicketKeys(candidateKeys, existingKeys = null) {
  const localSet = useMemo(
    () => (existingKeys ? buildExistingKeySet(existingKeys) : null),
    [existingKeys]
  );
  const [tick, setTick] = useState(0);

  const missingKeys = useMemo(() => {
    const out = [];
    for (const key of candidateKeys || []) {
      const upper = String(key || '').toUpperCase();
      if (!upper) continue;
      if (localSet?.has(upper)) continue;
      if (validatedKeyCache.has(upper)) continue;
      out.push(upper);
    }
    return out;
  }, [candidateKeys, localSet]);

  useEffect(() => {
    if (missingKeys.length === 0) return undefined;
    let active = true;
    scheduleBatchValidation(missingKeys).then(() => {
      if (active) setTick((n) => n + 1);
    });
    return () => {
      active = false;
    };
  }, [missingKeys]);

  return useMemo(() => {
    const result = new Set(localSet || []);
    for (const key of candidateKeys || []) {
      const upper = String(key || '').toUpperCase();
      if (validatedKeyCache.get(upper) === true) {
        result.add(upper);
      }
    }
    return result;
  }, [candidateKeys, localSet, tick]);
}

/**
 * Clickable ticket reference anchor.
 * - Normal left-click opens the ticket modal via `onOpenTicket(ticketKey)`.
 * - Ctrl/Cmd+Click, middle-click, and right-click preserve standard browser
 *   `<a href="/t/KEY">` behavior.
 */
export function TicketRefLink({
  ticketKey,
  label,
  onOpenTicket,
  className = 'ai-ticket-link',
  title,
}) {
  const upperKey = String(ticketKey || '').toUpperCase();
  const href = ticketHref(upperKey);

  function handleClick(event) {
    if (!onOpenTicket) return;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onOpenTicket(upperKey);
  }

  return (
    <a
      href={href}
      data-key={upperKey}
      className={className}
      title={title || `Open ticket ${upperKey}`}
      onClick={handleClick}
    >
      {label ?? upperKey}
    </a>
  );
}

/**
 * Renders plain text with validated ticket references turned into clickable links.
 */
export default function TicketText({
  text,
  validPrefixes = null,
  existingKeys = null,
  onOpenTicket,
  linkClassName = 'ai-ticket-link',
}) {
  const candidates = useMemo(
    () => extractCandidateTicketKeys(text, { validPrefixes }),
    [text, validPrefixes]
  );

  const verifiedSet = useValidatedTicketKeys(candidates, existingKeys);

  const segments = useMemo(() => {
    if (!text || typeof text !== 'string') return [];
    if (verifiedSet.size === 0) return [{ type: 'text', value: text }];
    return tokenizeTicketRefs(text, {
      validPrefixes,
      existingKeys: verifiedSet,
      requireExisting: true,
    });
  }, [text, validPrefixes, verifiedSet]);

  if (!text || typeof text !== 'string') return text ?? null;
  if (segments.length === 1 && segments[0].type === 'text') return text;

  return segments.map((seg, index) => {
    if (seg.type === 'text') return seg.value;
    return (
      <TicketRefLink
        key={`${seg.key}-${index}`}
        ticketKey={seg.key}
        label={seg.raw}
        onOpenTicket={onOpenTicket}
        className={linkClassName}
      />
    );
  });
}

/**
 * Small inline status / error feedback strip for modal key lookups.
 */
export function TicketModalStatus({ modal }) {
  if (!modal?.loadingKey && !modal?.lookupError) return null;
  return (
    <>
      {modal.loadingKey && (
        <div className="tm-lookup-banner" role="status" aria-live="polite">
          Opening {modal.loadingKey}…
        </div>
      )}
      {modal.lookupError && (
        <div className="error-banner" role="alert">
          <strong>Ticket unavailable:</strong> {modal.lookupError}
          <button type="button" onClick={modal.clearLookupError}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
