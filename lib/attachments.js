import { db } from './db';

// Every file on an active work item in the project. Archived work is hidden
// here the same way the board and list hide it; restoring the work item
// brings its files back.
const PROJECT_ATTACHMENTS_QUERY = `
  SELECT a.id, a.ticket_id, a.filename, a.content_type, a.size_bytes,
    a.created_at, a.uploaded_by, u.name AS uploaded_by_name,
    t.title, t.status, t.type, p.key AS project_key
  FROM ticket_attachments a
  JOIN tickets t ON t.id = a.ticket_id
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN users u ON u.id = a.uploaded_by
  WHERE t.project_id = ? AND t.archived = 0
  ORDER BY a.created_at DESC, a.id DESC
`;

export async function getProjectAttachments(projectId) {
  return db.prepare(PROJECT_ATTACHMENTS_QUERY).all(projectId);
}
