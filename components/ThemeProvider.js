'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { THEME_DEFAULT, THEME_MODES, THEME_STORAGE_KEY } from '@/lib/theme';

const ThemeContext = createContext(null);

function readStoredMode() {
  if (typeof window === 'undefined') return THEME_DEFAULT;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_MODES.includes(stored) ? stored : THEME_DEFAULT;
  } catch {
    return THEME_DEFAULT;
  }
}

function prefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveMode(mode) {
  if (mode === 'system') return prefersDark() ? 'dark' : 'light';
  return mode === 'dark' ? 'dark' : 'light';
}

export default function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(THEME_DEFAULT);
  const [resolved, setResolved] = useState(THEME_DEFAULT);

  const didApply = useRef(false);

  useEffect(() => {
    const stored = readStoredMode();
    const next = resolveMode(stored);
    const root = document.documentElement;
    root.setAttribute('data-theme', next);
    root.setAttribute('data-theme-mode', stored);
    root.style.colorScheme = next;
    setModeState(stored);
    setResolved(next);
  }, []);

  useEffect(() => {
    if (!didApply.current) {
      didApply.current = true;
      return;
    }
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-theme-mode', mode);
    root.style.colorScheme = resolved;
  }, [mode, resolved]);

  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined' || !window.matchMedia) {
      return undefined;
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setResolved(event.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next) => {
    if (!THEME_MODES.includes(next)) return;
    setModeState(next);
    setResolved(resolveMode(next));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      return;
    }
  }, []);

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
