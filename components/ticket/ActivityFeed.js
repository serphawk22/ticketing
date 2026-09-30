'use client';

import { useMemo, useState } from 'react';
import Avatar from '../Avatar';
import { PRIORITY_META, STATUS_META, FIELD_META, formatFullDateTime, ticketKey } from '../meta';
import { ArrowRightIcon, CommentIcon, HistoryIcon, SortDescIcon } from './icons';

const TABS = [
  { key: 'all', label: 'All', Icon: null },
  { key: 'comments', label: 'Comments', Icon: CommentIcon },
  { key: 'history', label: 'History', Icon: HistoryIcon },
  { key: 'worklog', label: 'Work log', Icon: HistoryIcon },
];

function ValueChip({ field, value }) {
  if (!value) return <span className="tm-chip-empty">empty</span>;
  if (field === 'status' && STATUS_META[value]) {
    const meta = STATUS_META[value];
    return (
      <span className="tm-lozenge" style={{ background: meta.bg, color: meta.text }}>
        {meta.label}
      </span>
    );
  }
  if (field === 'priority' && PRIORITY_META[value]) {
    const meta = PRIORITY_META[value];
    return (
      <span className="tm-lozenge" style={{ background: meta.bg, color: meta.text }}>
        {meta.label}
      </span>
    );
  }
  if (field === 'type') {
    return <span className="tm-chip-plain">{value}</span>;
  }
  if (field === 'employee_id') {
    return <span className="tm-chip-plain">user {value}</span>;
  }
  if (field === 'project_id') {
    return <span className="tm-chip-plain">project {value}</span>;
  }
  const text = String(value);
  return (
    <span className="tm-chip-plain" title={text}>
      {text.length > 40 ? `${text.slice(0, 40)}…` : text}
    </span>
  );
}

function ActivityRow({ entry }) {
  const meta = FIELD_META[entry.field];
  const label = meta?.label || entry.field;
  return (
    <li className="tm-activity-row">
      <Avatar name={entry.actor_name} assigned size={24} />
      <div className="tm-activity-body">
        <p className="tm-activity-text">
          <strong>{entry.actor_name || 'Someone'}</strong> changed the{' '}
          <span className="tm-activity-field">{label}</span>
        </p>
        <div className="tm-activity-change">
          <ValueChip field={entry.field} value={entry.from_value} />
          <ArrowRightIcon size={12} className="tm-arrow" />
          <ValueChip field={entry.field} value={entry.to_value} />
        </div>
        <time className="tm-activity-time">{formatFullDateTime(entry.created_at)}</time>
      </div>
    </li>
  );
}

function CommentRow({ comment, currentUser, onEdit, onDelete }) {
  const mine = currentUser && comment.author_id === currentUser.id;
  return (
    <li className="tm-comment">
      <Avatar name={comment.author_name} assigned size={24} />
      <div className="tm-comment-body">
        <p className="tm-comment-head">
          <strong>{comment.author_name}</strong>
          <time>{formatFullDateTime(comment.created_at)}</time>
          {comment.updated_at !== comment.created_at && <em className="tm-edited">edited</em>}
        </p>
        <p className="tm-comment-text">{comment.body}</p>
        {mine && (
          <div className="tm-comment-actions">
            <button type="button" onClick={() => onEdit(comment)}>Edit</button>
            <button type="button" onClick={() => onDelete(comment)}>Delete</button>
          </div>
        )}
      </div>
    </li>
  );
}

export default function ActivityFeed({
  activity,
  comments,
  timeLogs,
  currentUser,
  commentDraft,
  onCommentDraft,
  onAddComment,
  onEditComment,
  onDeleteComment,
}) {
  const [tab, setTab] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');

  const worklog = useMemo(
    () =>
      (timeLogs || []).map((log) => ({
        ...log,
        kind: 'worklog',
        at: log.created_at,
      })),
    [timeLogs]
  );

  const stamp = (v) => (v ? String(v).replace('T', ' ').slice(0, 19) : '');

  // "All" is one reverse-chronological stream of field changes, comments, and
  // time logs, which is what makes it worth having next to the filtered tabs.
  const all = useMemo(() => {
    const rows = [
      ...(activity || []).map((entry) => ({ ...entry, kind: 'activity', at: entry.created_at })),
      ...(comments || []).map((comment) => ({ ...comment, kind: 'comment', at: comment.created_at })),
      ...worklog,
    ];
    return rows.sort((a, b) => stamp(b.at).localeCompare(stamp(a.at)));
  }, [activity, comments, worklog]);

  const items = useMemo(() => {
    if (tab === 'history') return activity || [];
    if (tab === 'worklog') return worklog;
    if (tab === 'comments') return [];
    return all;
  }, [tab, activity, worklog, all]);

  const isEmpty =
    tab === 'comments'
      ? !(comments || []).length && !commentDraft.trim()
      : !items.length;

  function startEdit(comment) {
    setEditingId(comment.id);
    setEditDraft(comment.body);
  }

  async function saveEdit(id) {
    const body = editDraft.trim();
    if (body) await onEditComment(id, body);
    setEditingId(null);
    setEditDraft('');
  }

  return (
    <section className="tm-section tm-activity" aria-label="Activity">
      <h3 className="tm-section-title">Activity</h3>
      <div className="tm-subtabs" role="tablist" aria-label="Activity filter">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`tm-subtab${tab === key ? ' is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {Icon ? <Icon size={12} /> : null}
            {label}
            {key === 'comments' && comments?.length ? <span className="tm-count">{comments.length}</span> : null}
          </button>
        ))}
        <button type="button" className="tm-subtab-sort" title="Sort activity" aria-label="Sort activity">
          <SortDescIcon size={14} />
        </button>
      </div>

      {tab === 'comments' ? (
        <>
          <div className="tm-comment-new">
            <Avatar name={currentUser?.name} assigned size={24} />
            <div className="tm-comment-compose">
              <textarea
                className="tm-textarea"
                rows={2}
                value={commentDraft}
                placeholder="Add a comment..."
                onChange={(e) => onCommentDraft(e.target.value)}
              />
              <div className="tm-comment-compose-foot">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!commentDraft.trim()}
                  onClick={onAddComment}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
          <ul className="tm-activity-list">
            {(comments || []).map((comment) =>
              editingId === comment.id ? (
                <li key={comment.id} className="tm-comment">
                  <Avatar name={comment.author_name} assigned size={24} />
                  <div className="tm-comment-body">
                    <textarea
                      className="tm-textarea"
                      rows={3}
                      value={editDraft}
                      autoFocus
                      onChange={(e) => setEditDraft(e.target.value)}
                    />
                    <div className="tm-comment-actions">
                      <button type="button" onClick={() => saveEdit(comment.id)}>Save</button>
                      <button type="button" onClick={() => { setEditingId(null); setEditDraft(''); }}>Cancel</button>
                    </div>
                  </div>
                </li>
              ) : (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  currentUser={currentUser}
                  onEdit={startEdit}
                  onDelete={onDeleteComment}
                />
              )
            )}
          </ul>
        </>
      ) : tab === 'worklog' ? (
        <ul className="tm-activity-list">
          {worklog.map((log) => (
            <li key={log.id} className="tm-activity-row">
              <Avatar name={log.user_name} assigned size={24} />
              <div className="tm-activity-body">
                <p className="tm-activity-text">
                  <strong>{log.user_name}</strong> logged{' '}
                  <span className="tm-chip-plain">
                    {Math.round(log.seconds / 60)}m
                    {log.note ? ` — ${log.note}` : ''}
                  </span>
                </p>
                <time className="tm-activity-time">{formatFullDateTime(log.created_at)}</time>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="tm-activity-list">
          {items.map((entry) =>
            entry.kind === 'comment' ? (
              <CommentRow
                key={`c-${entry.id}`}
                comment={entry}
                currentUser={currentUser}
                onEdit={startEdit}
                onDelete={onDeleteComment}
              />
            ) : entry.kind === 'worklog' ? (
              <li key={`w-${entry.id}`} className="tm-activity-row">
                <Avatar name={entry.user_name} assigned size={24} />
                <div className="tm-activity-body">
                  <p className="tm-activity-text">
                    <strong>{entry.user_name}</strong> logged{' '}
                    <span className="tm-chip-plain">
                      {Math.round(entry.seconds / 60)}m
                      {entry.note ? ` — ${entry.note}` : ''}
                    </span>
                  </p>
                  <time className="tm-activity-time">{formatFullDateTime(entry.created_at)}</time>
                </div>
              </li>
            ) : (
              <ActivityRow key={`a-${entry.id}-${entry.field}`} entry={entry} />
            )
          )}
        </ul>
      )}

      {isEmpty && <p className="tm-empty">Nothing here yet.</p>}
    </section>
  );
}
