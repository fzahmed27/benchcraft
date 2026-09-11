import { sqliteTable,text,index } from 'drizzle-orm/sqlite-core';
export const projects=sqliteTable('projects',{id:text('id').primaryKey(),name:text('name').notNull(),payload:text('payload').notNull(),updatedAt:text('updated_at').notNull()},t=>[index('idx_projects_updated_at').on(t.updatedAt)]);
