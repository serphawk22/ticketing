'use client';

import { useState, useEffect } from 'react';

const FAQS = [
  {
    q: 'How do I change my account password?',
    a: 'Click the Settings icon (⚙️) in the top-right navbar and select "Change Password". You will need to enter your current password and choose a new one with at least 12 characters, uppercase and lowercase letters, a number, and a symbol.',
  },
  {
    q: 'How do parent and subtask tickets work?',
    a: 'You can nest subtasks under parent tickets. In the List view, click the "+" icon beside any ticket to create a child work item. Parents can be expanded or collapsed using the arrow caret.',
  },
  {
    q: 'How do I record my daily work on the Task Sheet?',
    a: 'Navigate to "Task Sheet" in the left sidebar under Issues. Fill in your name, project, hours worked, completed/in-progress status, and blockers. You can also fill out the Happy Sheet on the same page.',
  },
  {
    q: 'Where do bug reports and feedback go?',
    a: 'When you submit a bug report via the Help menu, it is automatically logged into the internal "Bug Reports" project. Team administrators and developers can triage and assign it immediately.',
  },
  {
    q: 'How does dark mode / theme switching work?',
    a: 'You can toggle themes using the 🌙/☀️ icon directly in the top navbar, or select Light, Dark, or System Auto in the Settings menu. Both controls remain synchronized across the application.',
  },
];

const SHORTCUTS = [
  {
    keys: ['Escape'],
    desc: 'Close any open modal dialog, dismiss dropdown menus, clear search suggestions, or cancel bulk selection.',
  },
  {
    keys: ['Alt', '↓'],
    desc: 'Navigate to the next ticket while inside the Ticket Detail modal.',
  },
  {
    keys: ['Alt', '↑'],
    desc: 'Navigate to the previous ticket while inside the Ticket Detail modal.',
  },
  {
    keys: ['↓', '↑'],
    desc: 'Move selection up or down through ticket search results in the top navigation search bar.',
  },
  {
    keys: ['Enter'],
    desc: 'Open the highlighted search result or submit active forms.',
  },
];

export default function FaqShortcutsModal({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('shortcuts');
  const [openFaq, setOpenFaq] = useState(0);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="faq-modal-title">
      <div className="modal-panel faq-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-title-wrap">
            <h2 id="faq-modal-title" className="modal-title">FAQs & Keyboard Shortcuts</h2>
            <p className="modal-subtitle">Quick answers and productivity shortcuts for Ticket Manager</p>
          </div>
          <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        <div className="faq-tab-bar" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'shortcuts'}
            className={`faq-tab-btn${activeTab === 'shortcuts' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('shortcuts')}
          >
            ⌨️ Keyboard Shortcuts
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'faq'}
            className={`faq-tab-btn${activeTab === 'faq' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('faq')}
          >
            ❓ Frequently Asked Questions
          </button>
        </div>

        <div className="faq-modal-body">
          {activeTab === 'shortcuts' ? (
            <div className="shortcuts-table-wrap">
              <table className="shortcuts-table">
                <thead>
                  <tr>
                    <th>Shortcut</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {SHORTCUTS.map((s, idx) => (
                    <tr key={idx}>
                      <td className="shortcuts-key-cell">
                        <div className="kbd-combo">
                          {s.keys.map((k, kidx) => (
                            <span key={kidx}>
                              <kbd className="kbd-badge">{k}</kbd>
                              {kidx < s.keys.length - 1 && <span className="kbd-plus">+</span>}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="shortcuts-desc-cell">{s.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="faq-accordion-list">
              {FAQS.map((item, idx) => {
                const isOpen = openFaq === idx;
                return (
                  <div key={idx} className={`faq-accordion-item${isOpen ? ' is-open' : ''}`}>
                    <button
                      type="button"
                      className="faq-accordion-trigger"
                      onClick={() => setOpenFaq(isOpen ? null : idx)}
                      aria-expanded={isOpen}
                    >
                      <span>{item.q}</span>
                      <span className="faq-chevron">{isOpen ? '−' : '+'}</span>
                    </button>
                    {isOpen && (
                      <div className="faq-accordion-content">
                        <p>{item.a}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

