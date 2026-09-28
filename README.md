# Ticket Manager

An internal ticket tracker built with Next.js (App Router) and React, styled
after Jira Cloud. It has a Kanban board, an employee directory, project
grouping, role-based permissions, and email notifications for assignments and
status changes.

## Features

- **Board** — drag-free status columns (`To Do`, `In Progress`, `Done`,
  `Closed`), project grouping, and "my tickets" filtering.
- **Employees** — directory with search, role/department/status filters,
  column sorting, create/edit, deactivate/reactivate, and delete guards that
  block removal while tickets are still assigned.
- **Projects** — create, rename, recolour, and delete projects. Deleting a
  project detaches its tickets instead of deleting them.
- **Roles** — `admin` can create tickets, manage employees and projects, and
  reassign tickets. `developer` can move tickets between statuses and edit
  tickets assigned to them.
- **Email** — assignment, reassignment, and start notifications through SMTP,
  with every message recorded in the `email_outbox` table and readable through
  `GET /api/outbox` for auditing.
- **Sessions** — opaque, database-backed sessions in an `HttpOnly`,
  `SameSite=Lax`, `Secure` (in production) cookie.

## Getting started

```bash
npm install
cp .env.example .env.local   # optional: SMTP settings
npm run dev
```

Open http://localhost:3000. The database is created and seeded automatically
on first request.

Seeded accounts:

| Email             | Password  | Role        |
| ----------------- | --------- | ----------- |
| `admin@example.com` | `admin123` | `admin`     |
| `dev@example.com`   | `dev123`   | `developer` |

## Database

Two drivers sit behind one small interface in `lib/db.js`:

| Environment            | Driver                       | Storage                    |
| ---------------------- | ---------------------------- | -------------------------- |
| Local / self-hosted    | `better-sqlite3`             | `data/app.db`              |
| Serverless (Vercel)    | `@libsql/client` (Turso)     | remote libSQL database     |

The driver is selected at runtime by the presence of `TURSO_DATABASE_URL`, and
it is created lazily so `next build` never needs credentials.

`data/` is git-ignored, so the local database is not shared between machines.
Set the Turso variables to share one database instead.

### Local data

```bash
npm run dev            # creates data/app.db on first request
rm -rf data            # reset to a freshly seeded database
```

### Turso / libSQL

```bash
npx @libsql/cli db create ticketing
npx @libsql/cli db tokens create --db ticketing   # copy the token
```

Add to `.env.local` (or your host's environment settings):

```bash
TURSO_DATABASE_URL="libsql://your-db.turso.io"
TURSO_AUTH_TOKEN="eyJ..."
```

The schema and seed run automatically on the first request against an empty
database. Existing rows are **not** migrated: to move local data across, dump
and restore it explicitly.

## Deploying to Vercel

1. Push this repository to GitHub and import it at
   https://vercel.com/new — no build settings are needed, Next.js is detected
   automatically.
2. Add the environment variables for the project:

   | Variable             | Required | Notes                                            |
   | -------------------- | -------- | ------------------------------------------------ |
   | `TURSO_DATABASE_URL` | **yes**  | Without it the app refuses to boot on Vercel.    |
   | `TURSO_AUTH_TOKEN`   | **yes**  | Token from `db tokens create`.                   |
   | `SMTP_SERVER`        | no       | Omit to disable sending; mail is logged instead. |
   | `SMTP_PORT`          | no       | Defaults to `587`.                               |
   | `SMTP_SECURE`        | no       | `"true"` for port 465.                           |
   | `OUTLOOK_EMAIL`      | no       | SMTP username.                                   |
   | `OUTLOOK_PASSWORD`   | no       | SMTP password or app password.                   |
   | `SENDER_EMAIL`       | no       | Envelope sender.                                 |
   | `APP_URL`            | no       | Public origin, used in notification links.       |

3. Deploy. The app creates its schema and seed data on the first request.

A local SQLite file cannot be used on Vercel because the filesystem is
ephemeral; `lib/db.js` throws a descriptive error if `TURSO_DATABASE_URL` is
missing on Vercel rather than silently serving an empty database.

## Scripts

| Command         | Description                        |
| --------------- | ---------------------------------- |
| `npm run dev`   | Development server on port 3000    |
| `npm run build` | Production build                   |
| `npm start`     | Serve the production build         |

> Session cookies are marked `Secure` when `NODE_ENV=production`, so testing
> `npm start` over plain `http://localhost` will log you straight back out.
> Use `npm run dev` for local testing, or test the production build over
> HTTPS.

## Project layout

```
app/
  api/            auth, tickets, employees, projects, outbox, users
  employees/      employee directory page
  projects/       projects page
  layout.js       root layout, fonts, metadata
  page.js         board page
components/       AppShell, Board, TicketCard, EmployeesView, ProjectsView
lib/
  db.js           dual-driver database layer, schema, seed
  auth.js         session creation, lookup, teardown
  tickets.js      ticket queries
  employees.js    employee queries
  projects.js     project queries
  mail.js         SMTP notifications and outbox
```
