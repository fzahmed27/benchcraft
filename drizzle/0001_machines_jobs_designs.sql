CREATE TABLE `designs` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`summary` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_designs_created_at` ON `designs` (`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`machine_id` text NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`progress` integer NOT NULL,
	`message` text NOT NULL,
	`requested_by` text NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`file_content` text NOT NULL,
	`settings` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_machine_state` ON `jobs` (`machine_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_jobs_updated_at` ON `jobs` (`updated_at`);--> statement-breakpoint
CREATE TABLE `machines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`adapter` text NOT NULL,
	`payload` text NOT NULL,
	`state` text NOT NULL,
	`detail` text NOT NULL,
	`last_seen_at` text,
	`registered_at` text NOT NULL
);
