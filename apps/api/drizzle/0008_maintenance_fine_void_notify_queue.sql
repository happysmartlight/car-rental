CREATE TABLE `maintenance_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`name` text NOT NULL,
	`preset` text,
	`interval_km` integer,
	`interval_months` integer,
	`last_odo` integer,
	`last_date` text,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `maintenance_items_vehicle_idx` ON `maintenance_items` (`vehicle_id`);--> statement-breakpoint
CREATE TABLE `maintenance_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`vehicle_id` integer NOT NULL,
	`done_date` text NOT NULL,
	`odo` integer,
	`cash_entry_id` integer,
	`notes` text,
	`created_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `maintenance_records_item_idx` ON `maintenance_records` (`item_id`,`done_date`);--> statement-breakpoint
CREATE TABLE `notify_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`html` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`sent_at` integer,
	`dropped_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notify_queue_pending_idx` ON `notify_queue` (`sent_at`,`next_attempt_at`);--> statement-breakpoint
ALTER TABLE `traffic_fines` ADD `voided_at` integer;--> statement-breakpoint
ALTER TABLE `traffic_fines` ADD `void_reason` text;