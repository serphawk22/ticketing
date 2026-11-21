'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import Avatar from '../Avatar';
import TicketText from '../TicketText';
import { PencilIcon, TrashIcon, SendIcon, CommentIcon, PaperclipIcon } from './icons';
import { ticketKey } from '../meta';
import { parseCommentAttachments, formatAttachmentToken } from '../../lib/commentAttachments';

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
function isImage(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  return IMAGE_EXTS.has(ext);
}

function formatChatTime(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal.endsWith('Z') || dateVal.includes('+') ? dateVal : `${dateVal}Z`);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getChatDayKey(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal.endsWith('Z') || dateVal.includes('+') ? dateVal : `${dateVal}Z`);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function getChatDateLabel(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal.endsWith('Z') || dateVal.includes('+') ? dateVal : `${dateVal}Z`);
  const now = new Date();

  const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const dKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  if (dKey === todayKey) return 'Today';

  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const yestKey = `${yest.getFullYear()}-${yest.getMonth() + 1}-${yest.getDate()}`;
  if (dKey === yestKey) return 'Yesterday';

  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export default function TicketGroupChat({
  ticket,
  watchers = [],
  comments = [],
  attachments = [],
  onUploadAttachment = null,
  onOpenAttachment = null,
  currentUser,
  commentDraft = '',
  onCommentDraft,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onRefreshComments,
  refreshingComments = false,
  isSubmitting = false,
  onOpenTicket = null,
  validPrefixes = null,
  existingKeys = null,
}) {
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const isFirstRender = useRef(true);

  const participants = useMemo(() => {
    const map = new Map();
    if (ticket?.assignee_name || ticket?.employee_name) {
      const name = ticket.assignee_name || ticket.employee_name;
      map.set(name, { name, role: 'Assignee' });
    }
    if (ticket?.created_by_name) {
      const name = ticket.created_by_name;
      map.set(name, {
        name,
        role: map.has(name) ? `${map.get(name).role} & Reporter` : 'Reporter',
      });
    }
    (watchers || []).forEach((w) => {
      if (w.name && !map.has(w.name)) {
        map.set(w.name, { name: w.name, role: 'Watcher' });
      }
    });
    (comments || []).forEach((c) => {
      if (c.author_name && !map.has(c.author_name)) {
        map.set(c.author_name, { name: c.author_name, role: 'Participant' });
      }
    });
    return Array.from(map.values());
  }, [ticket, watchers, comments]);

  // Auto-scroll to latest message on load and when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      if (isFirstRender.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
        isFirstRender.current = false;
      } else {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [comments.length]);

  function startEdit(comment) {
    setEditingId(comment.id);
    setEditDraft(comment.body);
  }

  async function saveEdit(id) {
    const body = editDraft.trim();
    if (body) {
      await onEditComment(id, body);
    }
    setEditingId(null);
    setEditDraft('');
  }

  async function handleSend() {
    if (uploading || isSubmitting) return;
    const text = commentDraft.trim();
    if (!text && pendingFiles.length === 0) return;

    if (pendingFiles.length === 0) {
      onAddComment();
      return;
    }

    setUploading(true);
    try {
      const tokens = [];
      for (const file of pendingFiles) {
        if (onUploadAttachment) {
          const res = await onUploadAttachment(file);
          const list = res?.attachments || [];
          const uploaded = list.find((a) => a.filename === file.name) || list[list.length - 1];
          if (uploaded) {
            tokens.push(`[attachment:${uploaded.id}:${file.name}]`);
          }
        }
      }
      const fullBody = [text, ...tokens].filter(Boolean).join('\n');
      setPendingFiles([]);
      await onAddComment(fullBody);
    } catch (err) {
      console.error('[TicketGroupChat] Failed to upload chat attachments:', err);
    } finally {
      setUploading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((commentDraft.trim() || pendingFiles.length > 0) && !isSubmitting && !uploading) {
        handleSend();
      }
    }
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  }

  function removePendingFile(idx) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function handlePaste(e) {
    if (e.clipboardData?.files?.length) {
      const files = Array.from(e.clipboardData.files);
      setPendingFiles((prev) => [...prev, ...files]);
    }
  }

  const key = ticket ? ticketKey(ticket) : '';

  return (
    <div className="tm-group-chat">
      {/* Group Chat Room Header */}
      <div className="tm-chat-header">
        <div className="tm-chat-header-info">
          <div className="tm-chat-header-title">
            <span className="tm-chat-title-text">
              {key ? `${key} Group Discussion` : 'Ticket Group Discussion'}
            </span>
            <button type="button" className="link-button" onClick={onRefreshComments} disabled={refreshingComments}>
              {refreshingComments ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <p className="tm-chat-header-subtitle">
            Open channel for assignee, reporter & team members
          </p>
        </div>

        {participants.length > 0 && (
          <div className="tm-chat-participants" title={`Participants: ${participants.map((p) => p.name).join(', ')}`}>
            <span className="tm-chat-participants-count">
              {participants.length} {participants.length === 1 ? 'member' : 'members'}
            </span>
            <div className="tm-chat-avatars-stack">
              {participants.slice(0, 4).map((p) => (
                <div key={p.name} className="tm-chat-avatar-wrap" title={`${p.name} (${p.role})`}>
                  <Avatar name={p.name} assigned size={22} />
                </div>
              ))}
              {participants.length > 4 && (
                <div className="tm-chat-avatar-more">+{participants.length - 4}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Messages Scroll Area */}
      <div className="tm-chat-feed" ref={messagesContainerRef}>
        {comments.length === 0 ? (
          <div className="tm-chat-empty">
            <div className="tm-chat-empty-icon">
              <CommentIcon size={32} />
            </div>
            <h4>Group Chat for this Ticket</h4>
            <p>
              No messages have been posted yet. Start the conversation with your team, assignee, or client below!
            </p>
          </div>
        ) : (
          comments.map((comment, index) => {
            const isMine = currentUser && comment.author_id === currentUser.id;
            const canEdit = isMine;
            const canDelete = isMine || currentUser?.role === 'admin';
            const prevComment = index > 0 ? comments[index - 1] : null;
            const showDateSep =
              !prevComment || getChatDayKey(comment.created_at) !== getChatDayKey(prevComment.created_at);
            const isEditing = editingId === comment.id;

            // Participant role badge if applicable
            let roleBadge = null;
            if (ticket?.assignee_name && comment.author_name === ticket.assignee_name) {
              roleBadge = 'Assignee';
            } else if (ticket?.created_by_name && comment.author_name === ticket.created_by_name) {
              roleBadge = 'Reporter';
            }

            return (
              <div key={comment.id} className="tm-chat-item-group">
                {showDateSep && (
                  <div className="tm-chat-date-separator">
                    <span>{getChatDateLabel(comment.created_at)}</span>
                  </div>
                )}

                <div
                  className={`tm-chat-message ${isMine ? 'tm-chat-mine' : 'tm-chat-other'}`}
                >
                  {!isMine && (
                    <div className="tm-chat-avatar-col">
                      <Avatar name={comment.author_name} assigned size={28} />
                    </div>
                  )}

                  <div className="tm-chat-bubble-col">
                    {!isMine && (
                      <div className="tm-chat-sender-info">
                        <strong className="tm-chat-sender-name">{comment.author_name}</strong>
                        {roleBadge && <span className="tm-chat-role-badge">{roleBadge}</span>}
                        <time className="tm-chat-time">{formatChatTime(comment.created_at)}</time>
                      </div>
                    )}

                    <div className="tm-chat-bubble-wrap">
                      <div className={`tm-chat-bubble ${isEditing ? 'is-editing' : ''}`}>
                        {isEditing ? (
                          <div className="tm-chat-inline-editor">
                            <textarea
                              className="tm-textarea tm-chat-edit-input"
                              rows={3}
                              value={editDraft}
                              autoFocus
                              spellCheck="true"
                              onChange={(e) => setEditDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  saveEdit(comment.id);
                                } else if (e.key === 'Escape') {
                                  setEditingId(null);
                                  setEditDraft('');
                                }
                              }}
                            />
                            <div className="tm-chat-edit-actions">
                              <button
                                type="button"
                                className="btn-secondary tm-chat-btn-xs"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditDraft('');
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary tm-chat-btn-xs"
                                onClick={() => saveEdit(comment.id)}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {(() => {
                              const parsed = parseCommentAttachments(comment.body);
                              return (
                                <>
                                  {parsed.text ? (
                                    <div className="tm-chat-text">
                                      <TicketText
                                        text={parsed.text}
                                        validPrefixes={validPrefixes}
                                        existingKeys={existingKeys}
                                        onOpenTicket={onOpenTicket}
                                        linkClassName="ai-ticket-link"
                                      />
                                    </div>
                                  ) : null}
                                  {parsed.attachments.length > 0 && (
                                    <div className="tm-chat-attachments-list">
                                      {parsed.attachments.map((att) => {
                                        const matched = (attachments || []).find((a) => a.id === att.id) || att;
                                        return (
                                          <button
                                            key={att.id}
                                            type="button"
                                            className="tm-chat-attachment-pill"
                                            onClick={() => onOpenAttachment && onOpenAttachment(matched)}
                                            title={`Open ${att.filename}`}
                                          >
                                            <PaperclipIcon size={12} />
                                            <span className="tm-chat-attachment-name">{att.filename}</span>
                                            {matched.size_bytes ? (
                                              <span className="tm-chat-attachment-size">({formatSize(matched.size_bytes)})</span>
                                            ) : null}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                            <div className="tm-chat-meta">
                              {comment.updated_at !== comment.created_at && (
                                <span className="tm-chat-edited">(edited)</span>
                              )}
                              {isMine && (
                                <time className="tm-chat-time-mine">
                                  {formatChatTime(comment.created_at)}
                                </time>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {!isEditing && (canEdit || canDelete) && (
                        <div className="tm-chat-hover-actions">
                          {canEdit && (
                            <button
                              type="button"
                              className="tm-chat-action-btn"
                              title="Edit message"
                              onClick={() => startEdit(comment)}
                            >
                              <PencilIcon size={12} />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              className="tm-chat-action-btn tm-chat-delete-btn"
                              title="Delete message"
                              onClick={() => onDeleteComment(comment)}
                            >
                              <TrashIcon size={12} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Sticky Chat Composer */}
      <div className="tm-chat-composer">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <div className="tm-chat-composer-avatar">
          <Avatar name={currentUser?.name} assigned size={28} />
        </div>
        <div className="tm-chat-input-wrapper">
          {pendingFiles.length > 0 && (
            <div className="tm-chat-pending-bar">
              {pendingFiles.map((f, i) => (
                <span key={i} className="tm-chat-pending-tag">
                  <PaperclipIcon size={12} />
                  <span className="tm-chat-pending-name">{f.name}</span>
                  <span className="tm-chat-pending-size">({formatSize(f.size)})</span>
                  <button
                    type="button"
                    className="tm-chat-pending-rm"
                    onClick={() => removePendingFile(i)}
                    aria-label={`Remove ${f.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {uploading && <span className="tm-chat-uploading-indicator">Uploading attachments…</span>}
            </div>
          )}
          <textarea
            className="tm-chat-textarea"
            rows={1}
            value={commentDraft}
            spellCheck="true"
            placeholder={`Message ${key ? `#${key}` : 'the group'}... (Enter to send, Shift+Enter for newline, paste screenshots directly)`}
            onChange={(e) => onCommentDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          <div className="tm-chat-composer-foot">
            <span className="tm-chat-hint">
              <strong>Enter</strong> to send &bull; <strong>Shift+Enter</strong> for newline
            </span>
            <div className="tm-chat-composer-actions">
              <button
                type="button"
                className="tm-chat-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || isSubmitting}
                title="Attach files or screenshots"
                aria-label="Attach files or screenshots"
              >
                <PaperclipIcon size={15} />
              </button>
              <button
                type="button"
                className="tm-chat-send-btn"
                disabled={(!commentDraft.trim() && pendingFiles.length === 0) || isSubmitting || uploading}
                onClick={handleSend}
                title="Send message (Enter)"
                aria-label="Send message"
              >
                <SendIcon size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
