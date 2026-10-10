CREATE TABLE `cash_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`direction` text NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL,
	`at` integer NOT NULL,
	`vehicle_id` integer,
	`method` text DEFAULT 'cash' NOT NULL,
	`description` text,
	`vendor` text,
	`odo` integer,
	`receipt_file_ids` text DEFAULT '[]' NOT NULL,
	`recurring_id` integer,
	`period` text,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`voided_at` integer,
	`void_reason` text
);
--> statement-breakpoint
CREATE INDEX `cash_entries_at_idx` ON `cash_entries` (`at`);--> statement-breakpoint
CREATE INDEX `cash_entries_vehicle_idx` ON `cash_entries` (`vehicle_id`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `cash_entries_recurring_uq` ON `cash_entries` (`recurring_id`,`period`);--> statement-breakpoint
CREATE TABLE `recurring_costs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL,
	`vehicle_id` integer,
	`method` text DEFAULT 'cash' NOT NULL,
	`description` text,
	`vendor` text,
	`day_of_month` integer DEFAULT 1 NOT NULL,
	`interval_months` integer DEFAULT 1 NOT NULL,
	`start_month` text NOT NULL,
	`end_month` text,
	`active` integer DEFAULT true NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
