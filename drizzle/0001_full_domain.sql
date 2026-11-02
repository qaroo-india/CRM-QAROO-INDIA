CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`summary` text NOT NULL,
	`before` text,
	`after` text,
	`request_id` text,
	`ip` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_occurred_idx` ON `audit_logs` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_id`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`family_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`replaced_by_id` text,
	`user_agent` text,
	`ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_hash_unique` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_idx` ON `refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE TABLE `saved_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`params` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_filters_user_scope_name_unique` ON `saved_filters` (`user_id`,`scope`,`name`);--> statement-breakpoint
CREATE TABLE `sequences` (
	`name` text NOT NULL,
	`year` integer NOT NULL,
	`value` integer NOT NULL,
	PRIMARY KEY(`name`, `year`),
	CONSTRAINT "sequences_value_positive" CHECK("sequences"."value" > 0)
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`industry` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_name_unique` ON `companies` (lower("name"));--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`duration_weeks` integer,
	`standard_fee_minor` integer NOT NULL,
	`modules` text NOT NULL,
	`placement_track` text,
	`default_admission_fee_minor` integer,
	`default_instalment_count` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "courses_fee_nonneg" CHECK("courses"."standard_fee_minor" >= 0),
	CONSTRAINT "courses_admission_fee_range" CHECK("courses"."default_admission_fee_minor" is null or ("courses"."default_admission_fee_minor" >= 0 and "courses"."default_admission_fee_minor" <= "courses"."standard_fee_minor")),
	CONSTRAINT "courses_instalments_range" CHECK("courses"."default_instalment_count" is null or "courses"."default_instalment_count" between 0 and 60),
	CONSTRAINT "courses_duration_positive" CHECK("courses"."duration_weeks" is null or "courses"."duration_weeks" > 0),
	CONSTRAINT "courses_track_check" CHECK("courses"."placement_track" is null or "courses"."placement_track" in ('technical', 'non_technical', 'both'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_code_unique` ON `courses` (upper("code"));--> statement-breakpoint
CREATE INDEX `courses_active_idx` ON `courses` (`is_active`);--> statement-breakpoint
CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_categories_name_unique` ON `expense_categories` (lower("name"));--> statement-breakpoint
CREATE TABLE `job_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`track` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "job_categories_track_check" CHECK("job_categories"."track" in ('technical', 'non_technical'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_categories_track_name_unique` ON `job_categories` (`track`,lower("name"));--> statement-breakpoint
CREATE TABLE `lead_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_sources_name_unique` ON `lead_sources` (lower("name"));--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`student_code` text NOT NULL,
	`full_name` text NOT NULL,
	`phone` text NOT NULL,
	`phone_normalized` text NOT NULL,
	`email` text,
	`address` text,
	`city` text,
	`date_of_birth` text,
	`emergency_contact_name` text,
	`emergency_contact_phone` text,
	`notes` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "students_dob_format" CHECK("students"."date_of_birth" is null or "students"."date_of_birth" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_code_unique` ON `students` (`student_code`);--> statement-breakpoint
CREATE INDEX `students_phone_idx` ON `students` (`phone_normalized`);--> statement-breakpoint
CREATE INDEX `students_email_idx` ON `students` (`email`);--> statement-breakpoint
CREATE INDEX `students_name_idx` ON `students` (`full_name`);--> statement-breakpoint
CREATE TABLE `trainers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`expertise` text,
	`is_active` integer DEFAULT true NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trainers_active_idx` ON `trainers` (`is_active`);--> statement-breakpoint
CREATE TABLE `lead_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`note` text,
	`metadata` text,
	`actor_id` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lead_activities_type_check" CHECK("lead_activities"."type" in ('note', 'call', 'email', 'meeting', 'status_change', 'assignment', 'follow_up_set', 'conversion'))
);
--> statement-breakpoint
CREATE INDEX `lead_activities_lead_idx` ON `lead_activities` (`lead_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_code` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`phone_normalized` text NOT NULL,
	`email` text,
	`enquiry_date` text NOT NULL,
	`lead_source_id` text NOT NULL,
	`campaign_name` text,
	`ad_reference` text,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`utm_term` text,
	`utm_content` text,
	`interested_course_id` text,
	`counsellor_id` text,
	`follow_up_date` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`lost_reason` text,
	`notes` text,
	`converted_on` text,
	`student_id` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lead_source_id`) REFERENCES `lead_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interested_course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counsellor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "leads_status_check" CHECK("leads"."status" in ('new', 'contacted', 'counselling_scheduled', 'follow_up', 'interested', 'converted', 'not_interested', 'lost', 'unreachable')),
	CONSTRAINT "leads_priority_check" CHECK("leads"."priority" in ('low', 'medium', 'high')),
	CONSTRAINT "leads_enquiry_date_format" CHECK("leads"."enquiry_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "leads_follow_up_format" CHECK("leads"."follow_up_date" is null or "leads"."follow_up_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "leads_conversion_consistent" CHECK(("leads"."status" = 'converted') = ("leads"."converted_on" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_code_unique` ON `leads` (`lead_code`);--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_source_idx` ON `leads` (`lead_source_id`);--> statement-breakpoint
CREATE INDEX `leads_counsellor_idx` ON `leads` (`counsellor_id`);--> statement-breakpoint
CREATE INDEX `leads_follow_up_idx` ON `leads` (`follow_up_date`);--> statement-breakpoint
CREATE INDEX `leads_phone_idx` ON `leads` (`phone_normalized`);--> statement-breakpoint
CREATE INDEX `leads_email_idx` ON `leads` (`email`);--> statement-breakpoint
CREATE INDEX `leads_enquiry_date_idx` ON `leads` (`enquiry_date`);--> statement-breakpoint
CREATE TABLE `admissions` (
	`id` text PRIMARY KEY NOT NULL,
	`admission_number` text NOT NULL,
	`student_id` text NOT NULL,
	`lead_id` text,
	`attributed_source_id` text,
	`course_id` text NOT NULL,
	`admission_date` text NOT NULL,
	`list_fee_minor` integer NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`agreed_fee_minor` integer NOT NULL,
	`admission_fee_required_minor` integer DEFAULT 0 NOT NULL,
	`counsellor_id` text,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`batch_status` text DEFAULT 'not_assigned' NOT NULL,
	`notes` text,
	`activated_on` text,
	`completed_on` text,
	`withdrawn_on` text,
	`cancelled_on` text,
	`status_reason` text,
	`idempotency_key` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attributed_source_id`) REFERENCES `lead_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counsellor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "admissions_status_check" CHECK("admissions"."status" in ('pending_payment', 'active', 'completed', 'withdrawn', 'cancelled')),
	CONSTRAINT "admissions_batch_status_check" CHECK("admissions"."batch_status" in ('not_assigned', 'waiting_for_next_batch', 'eligible', 'assigned', 'transferred', 'completed')),
	CONSTRAINT "admissions_date_format" CHECK("admissions"."admission_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "admissions_list_fee_nonneg" CHECK("admissions"."list_fee_minor" >= 0),
	CONSTRAINT "admissions_discount_range" CHECK("admissions"."discount_minor" >= 0 and "admissions"."discount_minor" <= "admissions"."list_fee_minor"),
	CONSTRAINT "admissions_agreed_fee_formula" CHECK("admissions"."agreed_fee_minor" = "admissions"."list_fee_minor" - "admissions"."discount_minor"),
	CONSTRAINT "admissions_admission_fee_range" CHECK("admissions"."admission_fee_required_minor" >= 0 and "admissions"."admission_fee_required_minor" <= "admissions"."agreed_fee_minor"),
	CONSTRAINT "admissions_cancelled_dated" CHECK(("admissions"."status" = 'cancelled') = ("admissions"."cancelled_on" is not null)),
	CONSTRAINT "admissions_withdrawn_dated" CHECK(("admissions"."status" = 'withdrawn') = ("admissions"."withdrawn_on" is not null)),
	CONSTRAINT "admissions_completed_dated" CHECK(("admissions"."status" = 'completed') = ("admissions"."completed_on" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admissions_number_unique` ON `admissions` (`admission_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `admissions_idempotency_unique` ON `admissions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `admissions_student_idx` ON `admissions` (`student_id`);--> statement-breakpoint
CREATE INDEX `admissions_course_idx` ON `admissions` (`course_id`);--> statement-breakpoint
CREATE INDEX `admissions_date_idx` ON `admissions` (`admission_date`);--> statement-breakpoint
CREATE INDEX `admissions_status_idx` ON `admissions` (`status`);--> statement-breakpoint
CREATE INDEX `admissions_counsellor_idx` ON `admissions` (`counsellor_id`);--> statement-breakpoint
CREATE INDEX `admissions_source_idx` ON `admissions` (`attributed_source_id`);--> statement-breakpoint
CREATE INDEX `admissions_lead_idx` ON `admissions` (`lead_id`);--> statement-breakpoint
CREATE TABLE `batch_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`admission_id` text NOT NULL,
	`student_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`assigned_on` text NOT NULL,
	`ended_on` text,
	`transferred_to_id` text,
	`reason` text,
	`assigned_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transferred_to_id`) REFERENCES `batch_assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "batch_assignments_status_check" CHECK("batch_assignments"."status" in ('active', 'transferred_out', 'completed', 'dropped')),
	CONSTRAINT "batch_assignments_assigned_format" CHECK("batch_assignments"."assigned_on" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batch_assignments_one_active` ON `batch_assignments` (`admission_id`) WHERE status = 'active';--> statement-breakpoint
CREATE INDEX `batch_assignments_batch_idx` ON `batch_assignments` (`batch_id`,`status`);--> statement-breakpoint
CREATE INDEX `batch_assignments_admission_idx` ON `batch_assignments` (`admission_id`);--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_code` text NOT NULL,
	`name` text NOT NULL,
	`course_id` text NOT NULL,
	`trainer_id` text,
	`start_date` text NOT NULL,
	`end_date` text,
	`capacity` integer NOT NULL,
	`schedule` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`notes` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trainer_id`) REFERENCES `trainers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "batches_status_check" CHECK("batches"."status" in ('planned', 'enrolling', 'running', 'completed', 'cancelled')),
	CONSTRAINT "batches_capacity_positive" CHECK("batches"."capacity" > 0 and "batches"."capacity" <= 1000),
	CONSTRAINT "batches_dates_ordered" CHECK("batches"."end_date" is null or "batches"."end_date" >= "batches"."start_date"),
	CONSTRAINT "batches_start_format" CHECK("batches"."start_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batches_code_unique` ON `batches` (upper("batch_code"));--> statement-breakpoint
CREATE INDEX `batches_course_idx` ON `batches` (`course_id`,`status`);--> statement-breakpoint
CREATE INDEX `batches_trainer_idx` ON `batches` (`trainer_id`);--> statement-breakpoint
CREATE TABLE `fee_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`admission_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`effective_date` text NOT NULL,
	`reason` text NOT NULL,
	`approved_by_id` text,
	`voided_at` integer,
	`void_reason` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fee_adjustments_type_check" CHECK("fee_adjustments"."type" in ('discount', 'waiver', 'write_off')),
	CONSTRAINT "fee_adjustments_amount_positive" CHECK("fee_adjustments"."amount_minor" > 0),
	CONSTRAINT "fee_adjustments_date_format" CHECK("fee_adjustments"."effective_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE INDEX `fee_adjustments_admission_idx` ON `fee_adjustments` (`admission_id`,`effective_date`);--> statement-breakpoint
CREATE TABLE `fee_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`admission_id` text NOT NULL,
	`plan_type` text NOT NULL,
	`total_minor` integer NOT NULL,
	`admission_fee_minor` integer DEFAULT 0 NOT NULL,
	`instalment_count` integer DEFAULT 0 NOT NULL,
	`start_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`superseded_at` integer,
	`notes` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fee_plans_type_check" CHECK("fee_plans"."plan_type" in ('full_payment', 'admission_plus_monthly', 'admission_plus_flexible', 'internal_financing', 'external_financing')),
	CONSTRAINT "fee_plans_status_check" CHECK("fee_plans"."status" in ('active', 'superseded')),
	CONSTRAINT "fee_plans_total_nonneg" CHECK("fee_plans"."total_minor" >= 0),
	CONSTRAINT "fee_plans_admission_fee_range" CHECK("fee_plans"."admission_fee_minor" >= 0 and "fee_plans"."admission_fee_minor" <= "fee_plans"."total_minor")
);
--> statement-breakpoint
CREATE INDEX `fee_plans_admission_idx` ON `fee_plans` (`admission_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fee_plans_one_active` ON `fee_plans` (`admission_id`) WHERE status = 'active';--> statement-breakpoint
CREATE TABLE `instalments` (
	`id` text PRIMARY KEY NOT NULL,
	`fee_plan_id` text NOT NULL,
	`admission_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`due_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`state_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`fee_plan_id`) REFERENCES `fee_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "instalments_kind_check" CHECK("instalments"."kind" in ('admission_fee', 'instalment', 'full_payment', 'loan_disbursement')),
	CONSTRAINT "instalments_state_check" CHECK("instalments"."state" in ('active', 'waived', 'cancelled')),
	CONSTRAINT "instalments_amount_positive" CHECK("instalments"."amount_minor" > 0),
	CONSTRAINT "instalments_due_format" CHECK("instalments"."due_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "instalments_sequence_positive" CHECK("instalments"."sequence" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instalments_plan_sequence_unique` ON `instalments` (`fee_plan_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `instalments_admission_due_idx` ON `instalments` (`admission_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `instalments_due_idx` ON `instalments` (`due_date`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`storage_key` text NOT NULL,
	`access_level` text DEFAULT 'general' NOT NULL,
	`uploaded_by_id` text,
	`deleted_at` integer,
	`deleted_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_owner_type_check" CHECK("documents"."owner_type" in ('student', 'admission', 'loan', 'expense', 'placement_application', 'institute')),
	CONSTRAINT "documents_access_check" CHECK("documents"."access_level" in ('general', 'restricted')),
	CONSTRAINT "documents_size_positive" CHECK("documents"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_storage_key_unique` ON `documents` (`storage_key`);--> statement-breakpoint
CREATE INDEX `documents_owner_idx` ON `documents` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
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
	CONSTRAINT "notifications_type_check" CHECK("notifications"."type" in ('instalment_due', 'instalment_overdue', 'follow_up_due', 'follow_up_missed', 'new_admission', 'unassigned_student', 'batch_capacity', 'loan_status_change', 'interview_upcoming', 'placement_offer', 'report_failed', 'email_failed')),
	CONSTRAINT "notifications_severity_check" CHECK("notifications"."severity" in ('info', 'success', 'warning', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_dedupe_unique` ON `notifications` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_user_unread_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `report_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`report_job_id` text NOT NULL,
	`recipients` text NOT NULL,
	`subject` text NOT NULL,
	`message` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`provider_message_id` text,
	`sent_at` integer,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`report_job_id`) REFERENCES `report_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "report_deliveries_status_check" CHECK("report_deliveries"."status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `report_deliveries_status_idx` ON `report_deliveries` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `report_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`report_type` text NOT NULL,
	`format` text NOT NULL,
	`params` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`file_name` text,
	`size_bytes` integer,
	`error` text,
	`requested_by_id` text,
	`schedule_id` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_id`) REFERENCES `report_schedules`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "report_jobs_status_check" CHECK("report_jobs"."status" in ('queued', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `report_jobs_created_idx` ON `report_jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `report_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`report_type` text NOT NULL,
	`format` text NOT NULL,
	`cadence` text NOT NULL,
	`time_of_day` text NOT NULL,
	`day_of_week` integer,
	`day_of_month` integer,
	`recipients` text NOT NULL,
	`filters` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer NOT NULL,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "report_schedules_cadence_check" CHECK("report_schedules"."cadence" in ('daily', 'weekly', 'monthly')),
	CONSTRAINT "report_schedules_time_format" CHECK("report_schedules"."time_of_day" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "report_schedules_dow_range" CHECK("report_schedules"."day_of_week" is null or "report_schedules"."day_of_week" between 0 and 6),
	CONSTRAINT "report_schedules_dom_range" CHECK("report_schedules"."day_of_month" is null or "report_schedules"."day_of_month" between 1 and 28)
);
--> statement-breakpoint
CREATE INDEX `report_schedules_due_idx` ON `report_schedules` (`is_active`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_code` text NOT NULL,
	`expense_date` text NOT NULL,
	`category_id` text NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`payment_method` text NOT NULL,
	`payee` text,
	`reference_number` text,
	`receipt_document_id` text,
	`approval_status` text DEFAULT 'recorded' NOT NULL,
	`approved_by_id` text,
	`approved_at` integer,
	`rejection_reason` text,
	`voided_at` integer,
	`voided_by_id` text,
	`void_reason` text,
	`recorded_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expenses_amount_positive" CHECK("expenses"."amount_minor" > 0),
	CONSTRAINT "expenses_status_check" CHECK("expenses"."approval_status" in ('recorded', 'pending', 'approved', 'rejected')),
	CONSTRAINT "expenses_method_check" CHECK("expenses"."payment_method" in ('cash', 'upi', 'bank_transfer', 'debit_card', 'credit_card', 'cheque', 'finance_disbursement', 'other')),
	CONSTRAINT "expenses_date_format" CHECK("expenses"."expense_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "expenses_void_consistent" CHECK(("expenses"."voided_at" is null) = ("expenses"."void_reason" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_code_unique` ON `expenses` (`expense_code`);--> statement-breakpoint
CREATE INDEX `expenses_date_idx` ON `expenses` (`expense_date`);--> statement-breakpoint
CREATE INDEX `expenses_category_idx` ON `expenses` (`category_id`);--> statement-breakpoint
CREATE INDEX `expenses_status_idx` ON `expenses` (`approval_status`);--> statement-breakpoint
CREATE TABLE `loan_disbursements` (
	`id` text PRIMARY KEY NOT NULL,
	`loan_id` text NOT NULL,
	`disbursed_on` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`reference` text,
	`payment_id` text,
	`notes` text,
	`recorded_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "loan_disbursements_amount_positive" CHECK("loan_disbursements"."amount_minor" > 0),
	CONSTRAINT "loan_disbursements_date_format" CHECK("loan_disbursements"."disbursed_on" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE INDEX `loan_disbursements_loan_idx` ON `loan_disbursements` (`loan_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `loan_disbursements_payment_unique` ON `loan_disbursements` (`payment_id`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` text PRIMARY KEY NOT NULL,
	`admission_id` text NOT NULL,
	`student_id` text NOT NULL,
	`finance_type` text NOT NULL,
	`provider_name` text NOT NULL,
	`application_reference` text,
	`requested_minor` integer NOT NULL,
	`approved_minor` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`applied_on` text,
	`decision_on` text,
	`rejection_reason` text,
	`notes` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "loans_type_check" CHECK("loans"."finance_type" in ('internal_instalment', 'external_loan')),
	CONSTRAINT "loans_status_check" CHECK("loans"."status" in ('draft', 'applied', 'under_review', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "loans_requested_positive" CHECK("loans"."requested_minor" > 0),
	CONSTRAINT "loans_approved_nonneg" CHECK("loans"."approved_minor" is null or "loans"."approved_minor" >= 0),
	CONSTRAINT "loans_approval_has_amount" CHECK("loans"."status" <> 'approved' or "loans"."approved_minor" is not null)
);
--> statement-breakpoint
CREATE INDEX `loans_admission_idx` ON `loans` (`admission_id`);--> statement-breakpoint
CREATE INDEX `loans_status_idx` ON `loans` (`status`);--> statement-breakpoint
CREATE INDEX `loans_provider_idx` ON `loans` (`provider_name`);--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`admission_id` text NOT NULL,
	`instalment_id` text,
	`amount_minor` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instalment_id`) REFERENCES `instalments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_allocations_amount_positive" CHECK("payment_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX `payment_allocations_payment_idx` ON `payment_allocations` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_instalment_idx` ON `payment_allocations` (`instalment_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_admission_idx` ON `payment_allocations` (`admission_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_number` text NOT NULL,
	`idempotency_key` text,
	`request_hash` text,
	`student_id` text NOT NULL,
	`admission_id` text NOT NULL,
	`payment_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`direction` text DEFAULT 'in' NOT NULL,
	`payment_type` text NOT NULL,
	`method` text NOT NULL,
	`reference_number` text,
	`notes` text,
	`status` text DEFAULT 'succeeded' NOT NULL,
	`reversed_at` integer,
	`reversed_by_id` text,
	`reversal_reason` text,
	`refund_of_id` text,
	`recorded_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_of_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_amount_positive" CHECK("payments"."amount_minor" > 0),
	CONSTRAINT "payments_direction_check" CHECK("payments"."direction" in ('in', 'refund')),
	CONSTRAINT "payments_type_check" CHECK("payments"."payment_type" in ('admission_fee', 'instalment', 'full_payment', 'part_payment', 'loan_disbursement', 'refund', 'other')),
	CONSTRAINT "payments_method_check" CHECK("payments"."method" in ('cash', 'upi', 'bank_transfer', 'debit_card', 'credit_card', 'cheque', 'finance_disbursement', 'other')),
	CONSTRAINT "payments_status_check" CHECK("payments"."status" in ('pending', 'succeeded', 'failed', 'reversed')),
	CONSTRAINT "payments_date_format" CHECK("payments"."payment_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "payments_reversal_consistent" CHECK(("payments"."status" = 'reversed') = ("payments"."reversed_at" is not null)),
	CONSTRAINT "payments_refund_direction" CHECK("payments"."refund_of_id" is null or "payments"."direction" = 'refund')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_receipt_unique` ON `payments` (`receipt_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idempotency_unique` ON `payments` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `payments_date_idx` ON `payments` (`status`,`payment_date`);--> statement-breakpoint
CREATE INDEX `payments_admission_idx` ON `payments` (`admission_id`);--> statement-breakpoint
CREATE INDEX `payments_student_idx` ON `payments` (`student_id`);--> statement-breakpoint
CREATE INDEX `payments_recorded_by_idx` ON `payments` (`recorded_by_id`);--> statement-breakpoint
CREATE TABLE `interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`round_number` integer NOT NULL,
	`round_name` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`mode` text DEFAULT 'in_person' NOT NULL,
	`result` text DEFAULT 'scheduled' NOT NULL,
	`feedback` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `placement_applications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "interviews_mode_check" CHECK("interviews"."mode" in ('in_person', 'phone', 'video')),
	CONSTRAINT "interviews_result_check" CHECK("interviews"."result" in ('scheduled', 'passed', 'failed', 'no_show', 'cancelled')),
	CONSTRAINT "interviews_round_positive" CHECK("interviews"."round_number" > 0)
);
--> statement-breakpoint
CREATE INDEX `interviews_application_idx` ON `interviews` (`application_id`);--> statement-breakpoint
CREATE INDEX `interviews_scheduled_idx` ON `interviews` (`scheduled_at`);--> statement-breakpoint
CREATE TABLE `placement_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`student_id` text NOT NULL,
	`company_id` text NOT NULL,
	`job_title` text NOT NULL,
	`job_category_id` text,
	`location` text,
	`applied_on` text NOT NULL,
	`source` text,
	`job_description_ref` text,
	`outcome` text DEFAULT 'in_progress' NOT NULL,
	`rejection_reason` text,
	`offer_package_minor` integer,
	`offer_on` text,
	`joining_on` text,
	`notes` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `placement_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_category_id`) REFERENCES `job_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "placement_applications_outcome_check" CHECK("placement_applications"."outcome" in ('in_progress', 'selected', 'rejected', 'offer_received', 'offer_declined', 'joined', 'withdrawn')),
	CONSTRAINT "placement_applications_applied_format" CHECK("placement_applications"."applied_on" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "placement_applications_package_nonneg" CHECK("placement_applications"."offer_package_minor" is null or "placement_applications"."offer_package_minor" >= 0),
	CONSTRAINT "placement_applications_joined_dated" CHECK("placement_applications"."outcome" <> 'joined' or "placement_applications"."joining_on" is not null)
);
--> statement-breakpoint
CREATE INDEX `placement_applications_profile_idx` ON `placement_applications` (`profile_id`);--> statement-breakpoint
CREATE INDEX `placement_applications_student_idx` ON `placement_applications` (`student_id`);--> statement-breakpoint
CREATE INDEX `placement_applications_company_idx` ON `placement_applications` (`company_id`);--> statement-breakpoint
CREATE INDEX `placement_applications_outcome_idx` ON `placement_applications` (`outcome`);--> statement-breakpoint
CREATE TABLE `placement_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`admission_id` text NOT NULL,
	`track` text NOT NULL,
	`stage` text DEFAULT 'eligible' NOT NULL,
	`eligible_on` text,
	`resume_status` text DEFAULT 'not_started' NOT NULL,
	`skills` text NOT NULL,
	`readiness_score` integer,
	`coordinator_id` text,
	`notes` text,
	`stage_changed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coordinator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "placement_profiles_track_check" CHECK("placement_profiles"."track" in ('technical', 'non_technical')),
	CONSTRAINT "placement_profiles_stage_check" CHECK("placement_profiles"."stage" in ('eligible', 'resume_preparation', 'ready', 'applied', 'interview_scheduled', 'interviewing', 'selected', 'rejected', 'offer_received', 'joined', 'on_hold', 'withdrawn', 'not_seeking')),
	CONSTRAINT "placement_profiles_resume_check" CHECK("placement_profiles"."resume_status" in ('not_started', 'in_progress', 'ready')),
	CONSTRAINT "placement_profiles_score_range" CHECK("placement_profiles"."readiness_score" is null or "placement_profiles"."readiness_score" between 0 and 100),
	CONSTRAINT "placement_profiles_eligible_format" CHECK("placement_profiles"."eligible_on" is null or "placement_profiles"."eligible_on" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `placement_profiles_admission_unique` ON `placement_profiles` (`admission_id`);--> statement-breakpoint
CREATE INDEX `placement_profiles_student_idx` ON `placement_profiles` (`student_id`);--> statement-breakpoint
CREATE INDEX `placement_profiles_stage_idx` ON `placement_profiles` (`track`,`stage`);--> statement-breakpoint
CREATE INDEX `placement_profiles_eligible_idx` ON `placement_profiles` (`eligible_on`);--> statement-breakpoint
ALTER TABLE `users` ADD `must_change_password` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `institute_settings` ADD `expense_approval_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `institute_settings` ADD `due_reminder_days` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `institute_settings` ADD `unassigned_alert_days` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `institute_settings` ADD `report_recipients` text DEFAULT '[]' NOT NULL;