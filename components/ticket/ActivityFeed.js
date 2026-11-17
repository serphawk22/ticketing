'use client';

import { useMemo, useState } from 'react';
import Avatar from '../Avatar';
import TicketGroupChat from './TicketGroupChat';
import TicketText from '../TicketText';
import { PRIORITY_META, STATUS_META, INCLUSION_META, FIELD_META, formatFullDateTime, formatDuration, ticketKey } from '../meta';
import { ArrowRightIcon, CommentIcon, HistoryIcon, SortDescIcon } from './icons';

const TABS = [
  { key: 'all', label: 'All', Icon: null },
  { key: 'comments', label: 'Group Chat', Icon: CommentIcon },
  { key: 'history', label: 'History', Icon: HistoryIcon },
  { key: 'worklog', label: 'Work log', Icon: HistoryIcon },
];

// created_by is the reporter, and FIELD_META describes the editable fields
// rather than the columns, so its name lives here.
const FIELD_LABELS = { created_by: 'Reporter', pr_url: 'Pull Request', github_branch: 'Branch' };

export function ActivityValue({ field, value }) {
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
  if (field === 'product_inclusion_status' && INCLUSION_META[value]) {
    const meta = INCLUSION_META[value];
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
    // Assignment is logged translated to a name, but an older row may still
    // hold the raw id, so fall back to "user N" when the value is numeric.
    return /^\d+$/.test(String(value)) ? (
      <span className="tm-chip-plain">user {value}</span>
    ) : (
      <span className="tm-chip-plain">{value}</span>
    );
  }
  // Already a name: the reporter change is logged translated, not by id.
  if (field === 'created_by') {
    return <span className="tm-chip-plain">{value}</span>;
  }
  if (field === 'project_id') {
    return <span className="tm-chip-plain">project {value}</span>;
  }
  if (field === 'pr_url') {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="tm-chip-plain"
        style={{ color: 'var(--link, #0c66e4)', textDecoration: 'none', fontWeight: 600 }}
      >
        {value.length > 50 ? `${value.slice(0, 50)}…` : value}
      </a>
    );
  }
  const text = String(value);
  return (
    <span className="tm-chip-plain" title={text}>
      {text.length > 40 ? `${text.slice(0, 40)}…` : text}
    </span>
  );
}

function ActivityRow({ entry }) {
  if (entry.field === 'created') {
    return (
      <li className="tm-activity-row">
        <Avatar name={entry.actor_name} assigned size={24} />
        <div className="tm-activity-body">
          <p className="tm-activity-text">
            <strong>{entry.actor_name || 'Someone'}</strong> created this work item
          </p>
          <time className="tm-activity-time">{formatFullDateTime(entry.created_at)}</time>
        </div>
      </li>
    );
  }

  if (entry.field === 'repository_id') {
    const actorDisplayName = entry.employee_name || entry.actor_name || 'Someone';
    return (
      <li className="tm-activity-row tm-activity-repo-change" style={{ alignItems: 'flex-start' }}>
        <Avatar name={actorDisplayName} assigned size={24} />
        <div className="tm-activity-body" style={{ width: '100%' }}>
          <p className="tm-activity-text">
            <strong>{actorDisplayName}</strong> changed the <span className="tm-activity-field">Repository</span>
          </p>
          <div className="tm-activity-change" style={{ marginBottom: '8px' }}>
            <span className="tm-chip-plain">{entry.from_value || 'None'}</span>
            <ArrowRightIcon size={12} className="tm-arrow" />
            <span className="tm-chip-plain" style={{ fontWeight: 600 }}>{entry.to_value || 'None'}</span>
          </div>
          {(entry.reason || entry.blocker) && (
            <div
              className="repo-change-history-card"
              style={{
                background: 'var(--subtle, #f4f5f7)',
                border: '1px solid var(--border, #dfe1e6)',
                borderRadius: '6px',
                padding: '10px 12px',
                fontSize: '12px',
                marginBottom: '6px',
              }}
            >
              {entry.reason && (
                <div style={{ marginBottom: entry.blocker ? '6px' : '0' }}>
                  <strong style={{ color: 'var(--muted, #666)', display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Reason for Change
                  </strong>
                  <span style={{ color: 'var(--text, #172b4d)', whiteSpace: 'pre-wrap' }}>{entry.reason}</span>
                </div>
              )}
              {entry.blocker && (
                <div>
                  <strong style={{ color: '#de350b', display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Reset Metadata
                  </strong>
                  <span style={{ color: 'var(--muted, #666)', fontSize: '11px' }}>{entry.blocker}</span>
                </div>
              )}
            </div>
          )}
          <time className="tm-activity-time">{formatFullDateTime(entry.created_at)}</time>
        </div>
      </li>
    );
  }

  if (entry.field === 'due_date' && (entry.blocker || entry.reason)) {
    const actorDisplayName = entry.employee_name || entry.actor_name || 'Employee';
    return (
      <li className="tm-activity-row tm-activity-due-date-change" style={{ alignItems: 'flex-start' }}>
        <Avatar name={actorDisplayName} assigned size={24} />
        <div className="tm-activity-body" style={{ width: '100%' }}>
          <p className="tm-activity-text">
            <strong>{actorDisplayName}</strong> changed the <span className="tm-activity-field">Due date</span>
          </p>
          <div className="tm-activity-change" style={{ marginBottom: '8px' }}>
            <ActivityValue field="due_date" value={entry.from_value} />
            <ArrowRightIcon size={12} className="tm-arrow" />
            <ActivityValue field="due_date" value={entry.to_value} />
          </div>
          <div
            className="due-date-history-card"
            style={{
              background: 'var(--subtle, #f4f5f7)',
              border: '1px solid var(--border, #dfe1e6)',
              borderRadius: '6px',
              padding: '10px 12px',
              fontSize: '12px',
              marginBottom: '6px',
            }}
          >
            {entry.blocker && (
              <div style={{ marginBottom: '6px' }}>
                <strong style={{ color: '#de350b', display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Blocker
                </strong>
                <span style={{ color: 'var(--text, #172b4d)', whiteSpace: 'pre-wrap' }}>{entry.blocker}</span>
              </div>
            )}
            {entry.reason && (
              <div>
                <strong style={{ color: 'var(--muted, #666)', display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Reason for delay
                </strong>
                <span style={{ color: 'var(--text, #172b4d)', whiteSpace: 'pre-wrap' }}>{entry.reason}</span>
              </div>
            )}
          </div>
          <time className="tm-activity-time">{formatFullDateTime(entry.created_at)}</time>
        </div>
      </li>
    );
  }

  const meta = FIELD_META[entry.field];
  const label = meta?.label || FIELD_LABELS[entry.field] || entry.field;
  return (
    <li className="tm-activity-row">
      <Avatar name={entry.actor_name} assigned size={24} />
      <div className="tm-activity-body">
        <p className="tm-activity-text">
          <strong>{entry.actor_name || 'Someone'}</strong> changed the{' '}
          <span className="tm-activity-field">{label}</span>
        </p>
        <div className="tm-activity-change">
          <ActivityValue field={entry.field} value={entry.from_value} />
          <ArrowRightIcon size={12} className="tm-arrow" />
          <ActivityValue field={entry.field} value={entry.to_value} />
        </div>
        <time className="tm-activity-time">{formatFullDateTime(entry.created_at)}</time>
      </div>
    </li>
  );
}

function CommentRow({
  comment,
  currentUser,
  onEdit,
  onDelete,
  onOpenTicket,
  validPrefixes,
  existingKeys,
}) {
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
        <p className="tm-comment-text">
          <TicketText
            text={comment.body}
            validPrefixes={validPrefixes}
            existingKeys={existingKeys}
            onOpenTicket={onOpenTicket}
            linkClassName="ai-ticket-link"
          />
        </p>
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
  ticket,
  watchers,
  activity,
  comments,
  timeLogs,
  currentUser,
  commentDraft,
  onCommentDraft,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onRefreshComments,
  refreshingComments,
  isSubmitting,
  initialTab,
  onOpenTicket = null,
  validPrefixes = null,
  existingKeys = null,
}) {
  const [tab, setTab] = useState(initialTab || 'all');
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
      ? false
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
      <h3 className="tm-section-title">Activity & Discussion</h3>
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
        <TicketGroupChat
          ticket={ticket}
          watchers={watchers}
          comments={comments}
          currentUser={currentUser}
          commentDraft={commentDraft}
          onCommentDraft={onCommentDraft}
          onAddComment={onAddComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onRefreshComments={onRefreshComments}
          refreshingComments={refreshingComments}
          isSubmitting={isSubmitting}
          onOpenTicket={onOpenTicket}
          validPrefixes={validPrefixes}
          existingKeys={existingKeys}
        />
      ) : tab === 'worklog' ? (
        <ul className="tm-activity-list">
          {worklog.map((log) => (
            <li key={log.id} className="tm-activity-row">
              <Avatar name={log.user_name} assigned size={24} />
              <div className="tm-activity-body">
                <p className="tm-activity-text">
                  <strong>{log.user_name}</strong> logged{' '}
                  <span className="tm-chip-plain">
                    {formatDuration(log.seconds)}
                    {log.note ? ` — ${log.note}` : ''}
                  </span>
                  {log.work_date && (
                    <span className="tm-muted" style={{ marginLeft: '6px', fontSize: '12px' }}>
                      ({log.work_date})
                    </span>
                  )}
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
                onOpenTicket={onOpenTicket}
                validPrefixes={validPrefixes}
                existingKeys={existingKeys}
              />
            ) : entry.kind === 'worklog' ? (
              <li key={`w-${entry.id}`} className="tm-activity-row">
                <Avatar name={entry.user_name} assigned size={24} />
                <div className="tm-activity-body">
                  <p className="tm-activity-text">
                    <strong>{entry.user_name}</strong> logged{' '}
                    <span className="tm-chip-plain">
                      {formatDuration(entry.seconds)}
                      {entry.note ? ` — ${entry.note}` : ''}
                    </span>
                    {entry.work_date && (
                      <span className="tm-muted" style={{ marginLeft: '6px', fontSize: '12px' }}>
                        ({entry.work_date})
                      </span>
                    )}
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
