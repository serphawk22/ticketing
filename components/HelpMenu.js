'use client';

import { useState, useRef, useEffect } from 'react';
import HelpCenterModal from './help/HelpCenterModal';
import BugReportModal from './help/BugReportModal';
import ContactSupportModal from './help/ContactSupportModal';
import FaqShortcutsModal from './help/FaqShortcutsModal';

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.7.2-1.2.9-1.2 1.6v.3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function BugIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="9" width="8" height="10" rx="4" />
      <path d="m19 7-3 2" />
      <path d="m5 7 3 2" />
      <path d="m19 19-3-2" />
      <path d="m5 19 3-2" />
      <path d="M20 13h-4" />
      <path d="M4 13h4" />
      <path d="M10 4.5 12 7l2-2.5" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
      <line x1="6" y1="8" x2="6.01" y2="8" />
      <line x1="10" y1="8" x2="10.01" y2="8" />
      <line x1="14" y1="8" x2="14.01" y2="8" />
      <line x1="18" y1="8" x2="18.01" y2="8" />
      <line x1="6" y1="12" x2="6.01" y2="12" />
      <line x1="18" y1="12" x2="18.01" y2="12" />
      <line x1="7" y1="16" x2="17" y2="16" />
    </svg>
  );
}

export default function HelpMenu({ onToast }) {
  const [open, setOpen] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <div className="help-menu-wrap" ref={ref}>
        <button
          type="button"
          className="icon-btn help-btn"
          aria-label="Help"
          title="Help"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <HelpIcon />
        </button>

        {open && (
          <div className="menu-popup help-menu" role="menu">
            <div className="help-menu-section-label">Help & Resources</div>

            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setActiveModal('guide');
              }}
            >
              <BookIcon />
              <span className="menu-item-text">Help Center / User Guide</span>
            </button>

            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setActiveModal('bug');
              }}
            >
              <BugIcon />
              <span className="menu-item-text">Report a Bug / Feedback</span>
            </button>

            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setActiveModal('support');
              }}
            >
              <PhoneIcon />
              <span className="menu-item-text">Contact Support</span>
            </button>

            <div className="menu-sep" />

            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setActiveModal('faq');
              }}
            >
              <KeyboardIcon />
              <span className="menu-item-text">FAQs & Shortcuts</span>
            </button>
          </div>
        )}
      </div>

      <HelpCenterModal
        open={activeModal === 'guide'}
        onClose={() => setActiveModal(null)}
      />

      <BugReportModal
        open={activeModal === 'bug'}
        onClose={() => setActiveModal(null)}
        onToast={onToast}
      />

      <ContactSupportModal
        open={activeModal === 'support'}
        onClose={() => setActiveModal(null)}
        onToast={onToast}
      />

      <FaqShortcutsModal
        open={activeModal === 'faq'}
        onClose={() => setActiveModal(null)}
      />
    </>
  );
}

