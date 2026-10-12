CREATE TABLE `password_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`requested_ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "password_tokens_purpose_check" CHECK("password_tokens"."purpose" in ('reset', 'activate'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_tokens_hash_unique` ON `password_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_tokens_user_idx` ON `password_tokens` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `placement_drive_batches` (
	`drive_id` text NOT NULL,
	`batch_id` text NOT NULL,
	PRIMARY KEY(`drive_id`, `batch_id`),
	FOREIGN KEY (`drive_id`) REFERENCES `placement_drives`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `placement_drives` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`role_title` text NOT NULL,
	`description` text,
	`track` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`drive_date` text NOT NULL,
	`apply_by` text,
	`package_minor` integer,
	`openings` integer DEFAULT 1 NOT NULL,
	`location` text,
	`is_remote` integer DEFAULT false NOT NULL,
	`eligibility_note` text,
	`coordinator_id` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coordinator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "placement_drives_status_check" CHECK("placement_drives"."status" in ('planned', 'open', 'closed')),
	CONSTRAINT "placement_drives_track_check" CHECK("placement_drives"."track" in ('technical', 'non_technical')),
	CONSTRAINT "placement_drives_openings_positive" CHECK("placement_drives"."openings" >= 1),
	CONSTRAINT "placement_drives_package_nonneg" CHECK("placement_drives"."package_minor" is null or "placement_drives"."package_minor" >= 0),
	CONSTRAINT "placement_drives_apply_before_drive" CHECK("placement_drives"."apply_by" is null or "placement_drives"."apply_by" <= "placement_drives"."drive_date")
);
--> statement-breakpoint
CREATE INDEX `placement_drives_status_idx` ON `placement_drives` (`status`,`drive_date`);--> statement-breakpoint
CREATE TABLE `attendance_records` (
	`id` text PRIMARY KEY NOT NULL,
	`attendance_session_id` text NOT NULL,
	`admission_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`minutes_late` integer DEFAULT 0 NOT NULL,
	`remark` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`attendance_session_id`) REFERENCES `attendance_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attendance_records_status_check" CHECK("attendance_records"."status" in ('present', 'absent', 'late', 'on_duty', 'holiday')),
	CONSTRAINT "attendance_records_minutes_late_range" CHECK("attendance_records"."minutes_late" between 0 and 720)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_records_session_admission_unique` ON `attendance_records` (`attendance_session_id`,`admission_id`);--> statement-breakpoint
CREATE INDEX `attendance_records_admission_idx` ON `attendance_records` (`admission_id`);--> statement-breakpoint
CREATE INDEX `attendance_records_student_idx` ON `attendance_records` (`student_id`);--> statement-breakpoint
CREATE TABLE `attendance_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`date` text NOT NULL,
	`class_session_id` text,
	`topic` text,
	`taken_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_session_id`) REFERENCES `class_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taken_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attendance_sessions_date_format" CHECK("attendance_sessions"."date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_sessions_batch_date_unique` ON `attendance_sessions` (`batch_id`,`date`);--> statement-breakpoint
CREATE INDEX `attendance_sessions_date_idx` ON `attendance_sessions` (`date`);--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`admission_id` text NOT NULL,
	`course_id` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`reference_number` text,
	`issued_on` text,
	`request_note` text,
	`review_note` text,
	`file_key` text,
	`requested_by_id` text,
	`reviewed_by_id` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "certificates_status_check" CHECK("certificates"."status" in ('requested', 'under_review', 'approved', 'issued', 'rejected')),
	CONSTRAINT "certificates_issued_complete" CHECK("certificates"."status" <> 'issued' or ("certificates"."reference_number" is not null and "certificates"."issued_on" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_reference_unique` ON `certificates` (`reference_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_one_live` ON `certificates` (`admission_id`) WHERE status <> 'rejected';--> statement-breakpoint
CREATE INDEX `certificates_student_idx` ON `certificates` (`student_id`,`status`);--> statement-breakpoint
CREATE TABLE `class_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`trainer_id` text,
	`title` text NOT NULL,
	`kind` text DEFAULT 'lecture' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`starts_at` integer NOT NULL,
	`duration_minutes` integer DEFAULT 60 NOT NULL,
	`location` text,
	`meeting_link` text,
	`description` text,
	`exam_id` text,
	`cancel_reason` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trainer_id`) REFERENCES `trainers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "class_sessions_kind_check" CHECK("class_sessions"."kind" in ('lecture', 'practical', 'revision', 'assessment')),
	CONSTRAINT "class_sessions_status_check" CHECK("class_sessions"."status" in ('scheduled', 'completed', 'cancelled')),
	CONSTRAINT "class_sessions_duration_range" CHECK("class_sessions"."duration_minutes" between 5 and 720),
	CONSTRAINT "class_sessions_cancel_reason" CHECK("class_sessions"."status" <> 'cancelled' or "class_sessions"."cancel_reason" is not null)
);
--> statement-breakpoint
CREATE INDEX `class_sessions_batch_idx` ON `class_sessions` (`batch_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `class_sessions_starts_idx` ON `class_sessions` (`starts_at`);--> statement-breakpoint
CREATE TABLE `exam_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`question_id` text NOT NULL,
	`option_id` text,
	`is_correct` integer DEFAULT false NOT NULL,
	`marks_awarded` integer DEFAULT 0 NOT NULL,
	`answered_at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `exam_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `exam_questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`option_id`) REFERENCES `exam_options`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exam_answers_marks_nonneg" CHECK("exam_answers"."marks_awarded" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_answers_attempt_question_unique` ON `exam_answers` (`attempt_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `exam_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`student_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`question_order` text NOT NULL,
	`started_at` integer NOT NULL,
	`deadline_at` integer NOT NULL,
	`submitted_at` integer,
	`auto_submitted` integer DEFAULT false NOT NULL,
	`score` integer,
	`total_marks` integer,
	`percent_bps` integer,
	`passed` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exam_attempts_number_positive" CHECK("exam_attempts"."attempt_number" >= 1),
	CONSTRAINT "exam_attempts_score_range" CHECK("exam_attempts"."score" is null or ("exam_attempts"."score" >= 0 and "exam_attempts"."score" <= "exam_attempts"."total_marks")),
	CONSTRAINT "exam_attempts_graded_together" CHECK(("exam_attempts"."submitted_at" is null) = ("exam_attempts"."score" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_attempts_number_unique` ON `exam_attempts` (`exam_id`,`student_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `exam_attempts_student_idx` ON `exam_attempts` (`student_id`);--> statement-breakpoint
CREATE TABLE `exam_options` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`text` text NOT NULL,
	`is_correct` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `exam_questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `exam_options_question_idx` ON `exam_options` (`question_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `exam_options_one_correct` ON `exam_options` (`question_id`) WHERE is_correct = 1;--> statement-breakpoint
CREATE TABLE `exam_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`text` text NOT NULL,
	`marks` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exam_questions_marks_range" CHECK("exam_questions"."marks" between 1 and 100)
);
--> statement-breakpoint
CREATE INDEX `exam_questions_exam_idx` ON `exam_questions` (`exam_id`,`position`);--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'unit_test' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`batch_id` text,
	`course_id` text,
	`author_id` text,
	`instructions` text,
	`duration_minutes` integer DEFAULT 30 NOT NULL,
	`pass_percent` integer DEFAULT 40 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`available_from` integer,
	`available_until` integer,
	`shuffle_questions` integer DEFAULT true NOT NULL,
	`total_marks` integer DEFAULT 0 NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exams_kind_check" CHECK("exams"."kind" in ('unit_test', 'session_test', 'placement_test')),
	CONSTRAINT "exams_status_check" CHECK("exams"."status" in ('draft', 'published', 'closed', 'archived')),
	CONSTRAINT "exams_target" CHECK(("exams"."batch_id" is null) <> ("exams"."course_id" is null)),
	CONSTRAINT "exams_duration_range" CHECK("exams"."duration_minutes" between 1 and 600),
	CONSTRAINT "exams_pass_range" CHECK("exams"."pass_percent" between 0 and 100),
	CONSTRAINT "exams_attempts_range" CHECK("exams"."max_attempts" between 1 and 20),
	CONSTRAINT "exams_window" CHECK("exams"."available_from" is null or "exams"."available_until" is null or "exams"."available_until" > "exams"."available_from")
);
--> statement-breakpoint
CREATE INDEX `exams_batch_idx` ON `exams` (`batch_id`,`status`);--> statement-breakpoint
CREATE INDEX `exams_course_idx` ON `exams` (`course_id`,`status`);--> statement-breakpoint
CREATE TABLE `material_access` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`user_id` text NOT NULL,
	`accessed_at` integer NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `material_access_material_idx` ON `material_access` (`material_id`,`accessed_at`);--> statement-breakpoint
CREATE INDEX `material_access_user_idx` ON `material_access` (`user_id`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'notes' NOT NULL,
	`course_id` text NOT NULL,
	`batch_id` text,
	`file_key` text,
	`file_name` text,
	`file_mime` text,
	`file_size` integer,
	`external_url` text,
	`is_published` integer DEFAULT true NOT NULL,
	`uploaded_by_id` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "materials_kind_check" CHECK("materials"."kind" in ('notes', 'slides', 'source_code', 'video', 'reference')),
	CONSTRAINT "materials_has_content" CHECK("materials"."file_key" is not null or "materials"."external_url" is not null)
);
--> statement-breakpoint
CREATE INDEX `materials_course_idx` ON `materials` (`course_id`,`is_published`);--> statement-breakpoint
CREATE INDEX `materials_batch_idx` ON `materials` (`batch_id`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_tag` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`description` text,
	`quantity_total` integer DEFAULT 1 NOT NULL,
	`quantity_available` integer DEFAULT 1 NOT NULL,
	`unit_value_minor` integer DEFAULT 0 NOT NULL,
	`is_consumable` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'in_service' NOT NULL,
	`condition` text,
	`location` text,
	`purchased_on` text,
	`notes` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_items_category_check" CHECK("inventory_items"."category" in ('laptop', 'desktop', 'peripheral', 'furniture', 'software', 'consumable', 'network', 'other')),
	CONSTRAINT "inventory_items_status_check" CHECK("inventory_items"."status" in ('in_service', 'repair', 'retired')),
	CONSTRAINT "inventory_items_quantity_range" CHECK("inventory_items"."quantity_total" >= 0 and "inventory_items"."quantity_available" >= 0 and "inventory_items"."quantity_available" <= "inventory_items"."quantity_total"),
	CONSTRAINT "inventory_items_value_nonneg" CHECK("inventory_items"."unit_value_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_tag_unique` ON `inventory_items` (upper("asset_tag"));--> statement-breakpoint
CREATE INDEX `inventory_items_category_idx` ON `inventory_items` (`category`,`status`);--> statement-breakpoint
CREATE TABLE `inventory_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`requested_by_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`needed_by` text,
	`reviewed_by_id` text,
	`reviewed_at` integer,
	`review_note` text,
	`issued_at` integer,
	`returned_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_requests_status_check" CHECK("inventory_requests"."status" in ('pending', 'issued', 'returned', 'rejected', 'cancelled')),
	CONSTRAINT "inventory_requests_quantity_positive" CHECK("inventory_requests"."quantity" >= 1)
);
--> statement-breakpoint
CREATE INDEX `inventory_requests_item_idx` ON `inventory_requests` (`item_id`,`status`);--> statement-breakpoint
CREATE INDEX `inventory_requests_requester_idx` ON `inventory_requests` (`requested_by_id`,`status`);--> statement-breakpoint
CREATE TABLE `leave_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`day_count` integer NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by_id` text,
	`reviewed_at` integer,
	`review_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "leave_requests_type_check" CHECK("leave_requests"."type" in ('casual', 'sick', 'earned', 'unpaid', 'maternity', 'paternity')),
	CONSTRAINT "leave_requests_status_check" CHECK("leave_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "leave_requests_dates_ordered" CHECK("leave_requests"."end_date" >= "leave_requests"."start_date"),
	CONSTRAINT "leave_requests_start_format" CHECK("leave_requests"."start_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "leave_requests_days_positive" CHECK("leave_requests"."day_count" >= 1)
);
--> statement-breakpoint
CREATE INDEX `leave_requests_user_idx` ON `leave_requests` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `leave_requests_dates_idx` ON `leave_requests` (`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`batch_id` text,
	`assigned_to_id` text,
	`created_by_id` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`due_date` text,
	`completed_at` integer,
	`attachment_key` text,
	`attachment_name` text,
	`attachment_mime` text,
	`attachment_size` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_priority_check" CHECK("tasks"."priority" in ('low', 'medium', 'high', 'urgent')),
	CONSTRAINT "tasks_status_check" CHECK("tasks"."status" in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
	CONSTRAINT "tasks_done_dated" CHECK(("tasks"."status" = 'done') = ("tasks"."completed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `tasks_assignee_idx` ON `tasks` (`assigned_to_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_due_idx` ON `tasks` (`due_date`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`entity_type` text,
	`entity_id` text,
	`link` text,
	`dedupe_key` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notifications_type_check" CHECK("__new_notifications"."type" in ('instalment_due', 'instalment_overdue', 'follow_up_due', 'follow_up_missed', 'new_admission', 'unassigned_student', 'batch_capacity', 'loan_status_change', 'interview_upcoming', 'placement_offer', 'report_failed', 'email_failed', 'leave_request', 'leave_decision', 'task_assigned', 'task_due', 'exam_published', 'class_scheduled', 'certificate_update', 'drive_open', 'inventory_request', 'inventory_decision')),
	CONSTRAINT "notifications_severity_check" CHECK("__new_notifications"."severity" in ('info', 'success', 'warning', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "user_id", "type", "severity", "title", "body", "entity_type", "entity_id", "link", "dedupe_key", "read_at", "created_at") SELECT "id", "user_id", "type", "severity", "title", "body", "entity_type", "entity_id", "link", "dedupe_key", "read_at", "created_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_dedupe_unique` ON `notifications` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_user_unread_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `account_type` text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `staff_code` text;--> statement-breakpoint
ALTER TABLE `users` ADD `designation` text;--> statement-breakpoint
ALTER TABLE `users` ADD `department` text;--> statement-breakpoint
ALTER TABLE `users` ADD `employment_type` text;--> statement-breakpoint
ALTER TABLE `users` ADD `joined_on` text;--> statement-breakpoint
ALTER TABLE `users` ADD `specialisation` text;--> statement-breakpoint
ALTER TABLE `users` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `users` ADD `photo_key` text;--> statement-breakpoint
ALTER TABLE `users` ADD `photo_mime` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_staff_code_unique` ON `users` (`staff_code`);--> statement-breakpoint
CREATE INDEX `users_account_type_idx` ON `users` (`account_type`,`is_active`);--> statement-breakpoint
ALTER TABLE `students` ADD `gender` text;--> statement-breakpoint
ALTER TABLE `students` ADD `qualification` text;--> statement-breakpoint
ALTER TABLE `students` ADD `year_of_passing` integer;--> statement-breakpoint
ALTER TABLE `students` ADD `state` text;--> statement-breakpoint
ALTER TABLE `students` ADD `pincode` text;--> statement-breakpoint
ALTER TABLE `students` ADD `guardian_name` text;--> statement-breakpoint
ALTER TABLE `students` ADD `guardian_phone` text;--> statement-breakpoint
ALTER TABLE `students` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `students_user_unique` ON `students` (`user_id`);--> statement-breakpoint
CREATE INDEX `students_status_idx` ON `students` (`status`);--> statement-breakpoint
ALTER TABLE `placement_applications` ADD `drive_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `placement_applications_drive_unique` ON `placement_applications` (`drive_id`,`profile_id`) WHERE drive_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `trainers_user_unique` ON `trainers` (`user_id`);