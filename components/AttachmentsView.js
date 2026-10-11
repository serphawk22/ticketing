'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import PageHeader from './PageHeader';
import ProjectTabs from './ProjectTabs';
import EmptyState from './EmptyState';
import TicketDetailModal from './ticket/TicketDetailModal';
import ConfirmModal from './ConfirmModal';
import useTicketModal from './useTicketModal';
import { useToasts, Toaster } from './Toaster';
import { TypeIcon, formatListDateTime, ticketKey } from './meta';
import { PaperclipIcon, TrashIcon } from './ticket/icons';

const KINDS = [
  { id: 'all', label: 'All types' },
  { id: 'image', label: 'Images' },
  { id: 'document', label: 'Documents' },
  { id: 'spreadsheet', label: 'Spreadsheets' },
  { id: 'presentation', label: 'Presentations' },
  { id: 'video', label: 'Videos' },
  { id: 'archive', label: 'Archives' },
  { id: 'other', label: 'Other' },
];

const SORTS = [
  { id: 'newest', label: 'Date added' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Size' },
  { id: 'work', label: 'Work item' },
];

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv']);
const SHEET_EXT = new Set(['xls', 'xlsx', 'csv', 'numbers', 'ods']);
const SLIDE_EXT = new Set(['ppt', 'pptx', 'key', 'odp']);
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz']);
const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'txt', 'rtf', 'md', 'pages', 'odt']);

const previewCache = new Map();

function extensionOf(filename) {
  const name = String(filename || '');
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

function fileKind(file) {
  const type = String(file.content_type || '').toLowerCase();
  const ext = extensionOf(file.filename);
  if (type.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image';
  if (type.startsWith('video/') || VIDEO_EXT.has(ext)) return 'video';
  if (SHEET_EXT.has(ext) || type.includes('spreadsheet') || type === 'text/csv') return 'spreadsheet';
  if (SLIDE_EXT.has(ext) || type.includes('presentation')) return 'presentation';
  if (ARCHIVE_EXT.has(ext) || type.includes('zip') || type.includes('compressed')) return 'archive';
  if (DOC_EXT.has(ext) || type.includes('pdf') || type.includes('word') || type.startsWith('text/')) return 'document';
  return 'other';
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

function workItem(file) {
  return {
    id: file.ticket_id,
    title: file.title,
    project_key: file.project_key,
    status: file.status,
    type: file.type,
  };
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function FileGlyph({ file }) {
  const ext = (extensionOf(file.filename) || 'file').slice(0, 4).toUpperCase();
  return (
    <span className={`att-glyph att-glyph-${fileKind(file)}`} aria-hidden="true">
      <span>{ext}</span>
    </span>
  );
}

function ImageThumb({ file }) {
  const [url, setUrl] = useState(previewCache.get(file.id) || '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url || failed) return undefined;
    let cancel = false;
    fetch(`/api/tickets/${file.ticket_id}/attachments?attachment=${file.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancel) return;
        if (data.url) {
          previewCache.set(file.id, data.url);
          setUrl(data.url);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancel) setFailed(true);
      });
    return () => {
      cancel = true;
    };
  }, [file.id, file.ticket_id, url, failed]);

  if (!url) return <FileGlyph file={file} />;
  return (
    <img
      src={url}
      alt=""
      onError={() => {
        previewCache.delete(file.id);
        setUrl('');
        setFailed(true);
      }}
    />
  );
}

export default function AttachmentsView({
  initialFiles,
  tickets,
  project,
  projects,
  employees,
  projectCounts,
  myIssuesCount,
  currentUser,
}) {
  const router = useRouter();
  const { toasts, push, dismiss, pause, resume } = useToasts();
  const modal = useTicketModal({ visible: tickets, lookup: tickets });
  const [files, setFiles] = useState(initialFiles);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('newest');
  const [view, setView] = useState('gallery');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setFiles(initialFiles);
  }, [initialFiles]);

  const canRemove = (file) =>
    Number(file.uploaded_by) === Number(currentUser.id) || currentUser.role === 'admin';

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = files.filter((file) => {
      if (kind !== 'all' && fileKind(file) !== kind) return false;
      if (!needle) return true;
      const key = ticketKey(workItem(file)).toLowerCase();
      return (
        file.filename.toLowerCase().includes(needle) ||
        key.includes(needle) ||
        (file.title || '').toLowerCase().includes(needle) ||
        (file.uploaded_by_name || '').toLowerCase().includes(needle)
      );
    });
    const copy = [...matched];
    copy.sort((a, b) => {
      if (sort === 'name') return a.filename.localeCompare(b.filename);
      if (sort === 'size') return (Number(b.size_bytes) || 0) - (Number(a.size_bytes) || 0);
      if (sort === 'work') return ticketKey(workItem(a)).localeCompare(ticketKey(workItem(b)));
      const aTime = Date.parse(String(a.created_at).replace(' ', 'T') + 'Z') || 0;
      const bTime = Date.parse(String(b.created_at).replace(' ', 'T') + 'Z') || 0;
      return sort === 'oldest' ? aTime - bTime : bTime - aTime;
    });
    return copy;
  }, [files, query, kind, sort]);

  async function openFile(file) {
    setError('');
    try {
      let url = previewCache.get(file.id);
      if (!url) {
        const res = await fetch(`/api/tickets/${file.ticket_id}/attachments?attachment=${file.id}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not open this file.');
        url = data.url;
        if (url) previewCache.set(file.id, url);
      }
      if (!url) throw new Error('Could not open this file.');
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmDelete() {
    const file = pendingDelete;
    if (!file) return;
    try {
      const res = await fetch(`/api/tickets/${file.ticket_id}/attachments?attachment=${file.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not remove this file.');
      previewCache.delete(file.id);
      setFiles((list) => list.filter((item) => item.id !== file.id));
      setPendingDelete(null);
      push({ message: `${file.filename} removed.` });
      router.refresh();
    } catch (err) {
      setPendingDelete(null);
      setError(err.message);
    }
  }

  function closeIssue() {
    modal.close();
    router.refresh();
  }

  const subtitle =
    files.length === 1
      ? '1 file attached to work items in this project.'
      : `${files.length} files attached to work items in this project.`;

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view="summary"
      filter="all"
      onFilterChange={() => {}}
      projectId={String(project.id)}
      onProjectChange={(id) => router.push(`/projects/${id}/attachments`)}
    >
      <div className="board">
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
            <button type="button" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        <PageHeader
          breadcrumb={[
            { label: 'Projects', href: '/projects' },
            { label: project.name, href: `/projects/${project.id}/summary` },
            { label: 'Attachments' },
          ]}
          project={project}
          title="Attachments"
          subtitle={subtitle}
        />
        <ProjectTabs projectId={project.id} active="attachments" />

        <div className="att-toolbar">
          <div className="search-field">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search attachments"
              aria-label="Search attachments"
            />
          </div>
          <label className="select-field">
            <span className="sr-only">File type</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="File type">
              {KINDS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <ChevronIcon />
          </label>
          <label className="select-field">
            <span className="sr-only">Sort attachments</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort attachments">
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <ChevronIcon />
          </label>
          <div className="att-view-toggle" role="group" aria-label="Attachments layout">
            <button
              type="button"
              className={view === 'gallery' ? 'is-active' : ''}
              aria-pressed={view === 'gallery'}
              onClick={() => setView('gallery')}
              title="Gallery"
            >
              <GridIcon />
              <span className="sr-only">Gallery</span>
            </button>
            <button
              type="button"
              className={view === 'list' ? 'is-active' : ''}
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
              title="List"
            >
              <ListIcon />
              <span className="sr-only">List</span>
            </button>
          </div>
        </div>

        {files.length === 0 ? (
          <EmptyState
            icon={<PaperclipIcon size={28} />}
            title="No attachments yet"
            text="Open a work item and drop a file on it. Everything attached in this project shows up here."
          />
        ) : visible.length === 0 ? (
          <p className="att-empty">No attachments match this search.</p>
        ) : view === 'gallery' ? (
          <ul className="att-grid">
            {visible.map((file) => (
              <li key={file.id} className="att-card">
                <button type="button" className="att-preview" onClick={() => openFile(file)} title="Open file">
                  {fileKind(file) === 'image' ? <ImageThumb file={file} /> : <FileGlyph file={file} />}
                </button>
                <div className="att-card-body">
                  <button type="button" className="att-name" onClick={() => openFile(file)}>
                    {file.filename}
                  </button>
                  <button type="button" className="att-work" onClick={() => modal.select(workItem(file))}>
                    <TypeIcon type={file.type} size={14} />
                    <span>{ticketKey(workItem(file))}</span>
                  </button>
                  <p className="att-meta">
                    {formatSize(file.size_bytes)} · {formatListDateTime(file.created_at)}
                    {file.uploaded_by_name ? ` · ${file.uploaded_by_name}` : ''}
                  </p>
                  {canRemove(file) && (
                    <button
                      type="button"
                      className="att-remove"
                      onClick={() => setPendingDelete(file)}
                      aria-label={`Remove ${file.filename}`}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="list-frame">
            <table className="list-table att-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Work item</th>
                  <th>Size</th>
                  <th>Added</th>
                  <th>Added by</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <button type="button" className="att-name" onClick={() => openFile(file)}>
                        <FileGlyph file={file} />
                        <span>{file.filename}</span>
                      </button>
                    </td>
                    <td>
                      <button type="button" className="att-work" onClick={() => modal.select(workItem(file))}>
                        <TypeIcon type={file.type} size={14} />
                        <span>{ticketKey(workItem(file))}</span>
                        <span className="att-title">{file.title}</span>
                      </button>
                    </td>
                    <td>{formatSize(file.size_bytes)}</td>
                    <td>{formatListDateTime(file.created_at)}</td>
                    <td>{file.uploaded_by_name || '—'}</td>
                    <td>
                      {canRemove(file) && (
                        <button
                          type="button"
                          className="att-remove"
                          onClick={() => setPendingDelete(file)}
                          aria-label={`Remove ${file.filename}`}
                        >
                          <TrashIcon size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal.selected && (
        <TicketDetailModal
          ticket={modal.selected}
          employees={employees}
          currentUser={currentUser}
          siblingTickets={tickets}
          canStep={modal.canStep}
          onClose={closeIssue}
          onNext={modal.next}
          onPrev={modal.prev}
          onOpenTicket={modal.select}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Remove attachment"
          message={`Remove ${pendingDelete.filename} from ${ticketKey(workItem(pendingDelete))}? This cannot be undone.`}
          confirmLabel="Remove"
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </AppShell>
  );
}
