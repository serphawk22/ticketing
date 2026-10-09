'use client';

import { useMemo, useRef, useState } from 'react';
import InlineDropdownField from '@/components/InlineDropdownField';

/**
 * The day's positive note, asked as two plain questions on the same page as the
 * task sheet. One row per person per day at most, but there is nothing to stop
 * an extra one -- nobody's mood keeps a schedule.
 *
 * Question one is required because it is the whole point of the sheet; question
 * two is optional because a day where you did not visibly land on anyone is a
 * day, not a failure, and forcing the answer would turn the sheet into a
 * chore. Both stay free text: a reason can be "the build stayed green" or "the
 * cat sat on the keyboard", and there is no shape worth barking at.
 */
export default function HappySheetForm({ people, defaults = {}, onSubmitted }) {
  const [name, setName] = useState(defaults.name || '');
  const [happyOne, setHappyOne] = useState('');
  const [happyOthers, setHappyOthers] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const firstRef = useRef(null);

  const nameOptions = useMemo(
    () => (people || []).map((p) => ({ value: p.name, label: p.name })),
    [people]
  );

  async function submit(e) {
    e.preventDefault();
    if (busy) return;

    const found = {};
    if (!name) found.name = 'Please select your name.';
    if (!happyOne.trim()) found.happyOne = 'Please tell us what made your day happy.';
    setErrors(found);

    const first = Object.keys(found)[0];
    if (first) {
      document
        .getElementById(`hs-${first}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (first === 'name') {
        const root = document.querySelector('#hs-name');
        const control =
          root?.querySelector('.idf-input') || root?.querySelector('.idf-trigger');
        control?.focus({ preventScroll: true });
      } else {
        document.querySelector(`#hs-${first} textarea`)?.focus({ preventScroll: true });
      }
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/happy-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          happyOne: happyOne.trim(),
          happyOthers: happyOthers.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save the happy sheet.');

      setConfirmation({ submission: data.submission, name, happyOne: happyOne.trim() });
      onSubmitted?.(name);
    } catch (err) {
      setErrors({ ...found, _form: err.message });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setName(defaults.name || '');
    setHappyOne('');
    setHappyOthers('');
    setErrors({});
    setConfirmation(null);
  }

  if (confirmation) {
    return (
      <div className="ts-confirmation" role="status">
        <div className="ts-confirmation-mark is-done" aria-hidden="true">
          🎉
        </div>
        <div>
          <h2>Happy sheet submitted</h2>
          <p className="ts-confirmation-line">
            <strong>{confirmation.name}</strong> · saved as row #{confirmation.submission.id}.
          </p>
          <p className="ts-confirmation-line ts-confirmation-task">
            “{confirmation.happyOne}”
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={reset}>
          Add another
        </button>
      </div>
    );
  }

  const errorList = Object.entries(errors).filter(([k]) => k !== '_form');

  return (
    <form className="ts-form" onSubmit={submit} noValidate>
      {errors._form && (
        <div className="ts-banner" role="alert">
          <strong>Happy sheet not saved.</strong> {errors._form}
        </div>
      )}

      {errorList.length > 0 && (
        <div className="ts-error-summary" role="alert">
          <strong>
            {errorList.length === 1
              ? 'One answer still needs attention.'
              : `${errorList.length} answers still need attention.`}
          </strong>
          <span>{errorList.map(([, m]) => m).join(' ')}</span>
        </div>
      )}

      <div
        className={`form-group ts-field${errors.name ? ' has-error' : ''}`}
        id="hs-name"
        role="group"
        aria-label="Name"
      >
        <span className="ts-legend">Name</span>
        <InlineDropdownField
          value={name}
          options={nameOptions}
          onSelect={setName}
          label="Name"
          emptyText="Select your name"
          variant="button"
          className="ts-select"
        />
        {errors.name ? <span className="error-text">{errors.name}</span> : null}
      </div>

      <div
        className={`form-group ts-field${errors.happyOne ? ' has-error' : ''}`}
        id="hs-happyOne"
      >
        <label htmlFor="hs-one">What made your day happy?</label>
        <textarea
          id="hs-one"
          ref={firstRef}
          rows={3}
          value={happyOne}
          placeholder="A small win, a kind word, a problem that dissolved…"
          onChange={(e) => setHappyOne(e.target.value)}
          aria-invalid={errors.happyOne ? 'true' : undefined}
        />
        {errors.happyOne ? <span className="error-text">{errors.happyOne}</span> : null}
      </div>

      <div className="form-group ts-field">
        <label htmlFor="hs-others">Did you make anybody else happy today?</label>
        <textarea
          id="hs-others"
          rows={3}
          value={happyOthers}
          placeholder="Who, and how? Feel free to leave it blank — a day already happy is enough."
          onChange={(e) => setHappyOthers(e.target.value)}
        />
        <p className="field-hint">Optional.</p>
      </div>

      <div className="ts-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit happy sheet'}
        </button>
        <p className="field-hint">No scoring, no tracking — just the day as it felt.</p>
      </div>
    </form>
  );
}