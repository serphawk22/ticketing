'use client';

let spellcheckerPromise = null;

export function loadSpellchecker() {
  if (!spellcheckerPromise) {
    spellcheckerPromise = (async () => {
      const [{ default: nspellModule }, response] = await Promise.all([
        import('nspell'),
        fetch('/api/spellcheck/dictionary', {
          cache: 'force-cache',
        }),
      ]);

      const nspell =
        typeof nspellModule === 'function'
          ? nspellModule
          : nspellModule?.default || nspellModule;

      if (!response.ok) {
        throw new Error('Unable to load the spellcheck dictionary.');
      }

      const { aff, dic } = await response.json();
      return nspell({ aff, dic });
    })().catch((error) => {
      spellcheckerPromise = null;
      throw error;
    });
  }

  return spellcheckerPromise;
}

export function isMisspelled(spellchecker, word) {
  if (!spellchecker || typeof spellchecker.correct !== 'function') return false;
  return !spellchecker.correct(word);
}

export function topSuggestions(spellchecker, word, limit = 3) {
  if (!spellchecker || typeof spellchecker.suggest !== 'function') return [];
  const suggestions = spellchecker.suggest(word);
  const seen = new Set();
  const result = [];

  for (const suggestion of suggestions) {
    const value = suggestion.trim();
    if (!value) continue;

    const key = value.toLowerCase();
    if (key === word.toLowerCase() || seen.has(key)) continue;

    seen.add(key);
    result.push(value);

    if (result.length === limit) break;
  }

  return result;
}
