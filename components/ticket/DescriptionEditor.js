'use client';

import { useEffect, useRef, useState } from 'react';
import { markdownToHtml, htmlToMarkdown } from '../../lib/richText';
import { BoldIcon, ItalicIcon, LinkIcon, ListIcon } from './icons';

const TOOLS = [
  { cmd: 'bold', label: 'Bold', Icon: BoldIcon },
  { cmd: 'italic', label: 'Italic', Icon: ItalicIcon },
  { cmd: 'insertUnorderedList', label: 'Bulleted list', Icon: ListIcon },
];

export default function DescriptionEditor({ value, onSave, canEdit = true }) {
  const [editing, setEditing] = useState(false);
  const editorRef = useRef(null);

  useEffect(() => {
    if (editing && editorRef.current) editorRef.current.focus();
  }, [editing]);

  function exec(cmd) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, null);
  }

  function link() {
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;
    if (!/^(https?:|mailto:)/i.test(url.trim())) {
      window.alert('Only http, https, and mailto links are allowed.');
      return;
    }
    editorRef.current?.focus();
    document.execCommand('createLink', false, url.trim());
  }

  function commit() {
    const markdown = htmlToMarkdown(editorRef.current);
    setEditing(false);
    if (markdown !== String(value || '').trim()) onSave(markdown);
  }

  function cancel() {
    setEditing(false);
  }

  if (!editing) {
    const empty = !String(value || '').trim();
    return (
      <div
        className={`tm-description${empty ? ' is-empty' : ''}${canEdit ? ' is-editable' : ''}`}
        onClick={() => canEdit && setEditing(true)}
        role={canEdit ? 'button' : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onKeyDown={(e) => {
          if (canEdit && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {empty ? 'Add a description...' : null}
        {empty ? null : (
          <div
            className="tm-description-body"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(value) }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="tm-rich">
      <div className="tm-rich-toolbar">
        {TOOLS.map(({ cmd, label, Icon }) => (
          <button
            key={cmd}
            type="button"
            className="tm-rich-btn"
            title={label}
            aria-label={label}
            onMouseDown={(e) => {
              e.preventDefault();
              exec(cmd);
            }}
          >
            <Icon size={14} />
          </button>
        ))}
        <button
          type="button"
          className="tm-rich-btn"
          title="Link"
          aria-label="Link"
          onMouseDown={(e) => {
            e.preventDefault();
            link();
          }}
        >
          <LinkIcon size={14} />
        </button>
      </div>
      <div
        ref={editorRef}
        className="tm-rich-body"
        contentEditable
        suppressContentEditableWarning
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancel();
          }
        }}
        dangerouslySetInnerHTML={{ __html: markdownToHtml(value) || '<p><br /></p>' }}
      />
      <div className="tm-rich-foot">
        <span className="tm-hint">Press Esc to cancel</span>
        <span className="tm-rich-actions">
          <button type="button" className="btn btn-link" onMouseDown={(e) => { e.preventDefault(); cancel(); }}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onMouseDown={(e) => { e.preventDefault(); commit(); }}>
            Save
          </button>
        </span>
      </div>
    </div>
  );
}
