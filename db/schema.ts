import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [index('idx_projects_updated_at').on(t.updatedAt)]);

/** Fabrication machines registered by a local bench agent (3D printers, CNC routers, lasers). */
export const machines = sqliteTable('machines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  adapter: text('adapter').notNull(),
  payload: text('payload').notNull(),
  state: text('state').notNull(),
  detail: text('detail').notNull(),
  lastSeenAt: text('last_seen_at'),
  registeredAt: text('registered_at').notNull(),
});

/** Fabrication jobs queued for a machine. File content lives in the row; binary files are not accepted inline. */
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  machineId: text('machine_id').notNull(),
  projectId: text('project_id'),
  title: text('title').notNull(),
  state: text('state').notNull(),
  progress: integer('progress').notNull(),
  message: text('message').notNull(),
  requestedBy: text('requested_by').notNull(),
  fileName: text('file_name').notNull(),
  fileType: text('file_type').notNull(),
  fileContent: text('file_content').notNull(),
  settings: text('settings').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [index('idx_jobs_machine_state').on(t.machineId, t.state), index('idx_jobs_updated_at').on(t.updatedAt)]);

/** Design records produced by the planner, so agents and the workbench can refer back to one by id. */
export const designs = sqliteTable('designs', {
  id: text('id').primaryKey(),
  prompt: text('prompt').notNull(),
  summary: text('summary').notNull(),
  payload: text('payload').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_designs_created_at').on(t.createdAt)]);
