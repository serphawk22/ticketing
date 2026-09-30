'use client';

import { useEffect, useState } from 'react';
import {
  AddWebLinkDialog,
  CloneDialog,
  ConvertToSubtaskDialog,
  LinkTicketDialog,
  MoveDialog,
  SlackChannelDialog,
  VotersDialog,
  WatchersDialog,
} from './rowDialogs';
import { ticketKey } from '../meta';

/**
 * Routes the open row-menu dialog to the component that owns it, and keeps the
 * per-ticket fetches (watchers, votes) in one place so the menu itself stays
 * presentational.
 */
export default function RowMenuDialog({
  state,
  tickets,
  projects,
  projectId,
  employees,
  currentUser,
  isAdmin,
  onClose,
  onPatch,
  onMove,
  onCreate,
  onError,
  onDone,
}) {
  const { key, ticket } = state;
  const [data, setData] = useState(state.data || {});

  // Actions that need server data pull it here, keyed on the ticket so moving
  // between rows refetches rather than showing the previous ticket's watchers.
  useEffect(() => {
    const needs = ['watchers', 'voters', 'watch', 'vote', 'slack', 'weblink'];
    if (!needs.includes(key)) return;
    let alive = true;
    fetch(`/api/tickets/${ticket.id}/detail`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setData({ watchers: d.watchers || [], votes: d.votes || [] });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, ticket.id]);

  async function guard(fn) {
    try {
      await fn();
    } catch (e) {
      onError(e.message);
    }
  }

  if (key === 'subtask') {
    return (
      <ConvertToSubtaskDialog
        ticket={ticket}
        tickets={tickets}
        projectId={projectId}
        onClose={onClose}
        onConfirm={(parent) =>
          guard(async () => {
            await onPatch(ticket.id, { parent_id: parent.id });
            onDone(`${ticketKey(ticket)} is now a sub-task of ${ticketKey(parent)}.`);
            onClose();
          })
        }
      />
    );
  }

  if (key === 'clone') {
    return (
      <CloneDialog
        ticket={ticket}
        onClose={onClose}
        onConfirm={async (payload) => {
          const { attachments, ...fields } = payload;
          const created = await onCreate(fields);
          // Attachments are copied through the existing per-ticket upload
          // endpoint after the clone exists, so a clone with files keeps them
          // without the create route learning about file storage.
          for (const file of attachments || []) {
            const body = new FormData();
            body.append('file', new Blob([file.data], { type: file.mime }), file.name);
            await fetch(`/api/tickets/${created.id}/attachments`, { method: 'POST', body });
          }
          onDone(`Cloned as ${ticketKey(created)}.`);
          onClose();
          return created;
        }}
      />
    );
  }

  if (key === 'link') {
    return (
      <LinkTicketDialog
        ticket={ticket}
        tickets={tickets}
        projectId={projectId}
        onClose={onClose}
        onConfirm={(other, type) =>
          guard(async () => {
            const res = await fetch(`/api/tickets/${ticket.id}/relations`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ related_ticket_id: other.id, relation_type: type }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || 'Could not link the work items.');
            onDone(`Linked ${ticketKey(ticket)} to ${ticketKey(other)}.`);
            onClose();
          })
        }
      />
    );
  }

  if (key === 'move') {
    return (
      <MoveDialog
        ticket={ticket}
        tickets={tickets}
        projects={projects}
        projectId={projectId}
        onClose={onClose}
        onConfirm={async ({ project_id, parent_id }) => {
          await (onMove || onPatch)(ticket.id, { project_id, parent_id });
          onDone(`Moved ${ticketKey(ticket)}.`);
          onClose();
        }}
      />
    );
  }

  if (key === 'weblink') {
    return (
      <AddWebLinkDialog
        onClose={onClose}
        onConfirm={async (link) => {
          const res = await fetch(`/api/tickets/${ticket.id}/web-links`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(link),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || 'Could not add the web link.');
          onDone('Web link added.');
          onClose();
        }}
      />
    );
  }

  if (key === 'slack') {
    return (
      <SlackChannelDialog
        ticket={ticket}
        onClose={onClose}
        onConfirm={async (channel) => {
          await onPatch(ticket.id, { slack_channel: channel });
          onDone(channel ? `Connected #${channel}.` : 'Slack channel disconnected.');
          onClose();
        }}
      />
    );
  }

  if (key === 'watch' || key === 'watchers') {
    return (
      <WatchersDialog
        ticketId={ticket.id}
        watchers={data.watchers || []}
        users={employees}
        currentUser={currentUser}
        isAdmin={isAdmin}
        onClose={onClose}
        onAdd={async (userId) => {
          const res = await fetch(`/api/tickets/${ticket.id}/watchers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || 'Could not add the watcher.');
          setData((d) => ({ ...d, watchers: body.watchers || [] }));
        }}
        onRemove={async (userId) => {
          const res = await fetch(`/api/tickets/${ticket.id}/watchers`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || 'Could not remove the watcher.');
          setData((d) => ({ ...d, watchers: body.watchers || [] }));
        }}
      />
    );
  }

  if (key === 'voters' || key === 'vote') {
    return (
      <VotersDialog
        votes={data.votes || []}
        currentUser={currentUser}
        onClose={onClose}
      />
    );
  }

  return null;
}
