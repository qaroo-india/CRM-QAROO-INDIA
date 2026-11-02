CREATE TABLE `import_previews` (
	`token` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`user_id` text NOT NULL,
	`file_name` text NOT NULL,
	`rows` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_previews_entity_check" CHECK("import_previews"."entity" in ('leads', 'students'))
);
--> statement-breakpoint
CREATE INDEX `import_previews_expires_idx` ON `import_previews` (`expires_at`);