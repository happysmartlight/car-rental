CREATE TABLE `accessory_catalog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`aliases` text,
	`category` text DEFAULT 'other' NOT NULL,
	`default_value` integer DEFAULT 0 NOT NULL,
	`highlight` integer DEFAULT false NOT NULL,
	`essential` integer DEFAULT false NOT NULL,
	`ev_only` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accessory_catalog_name_key_unique` ON `accessory_catalog` (`name_key`);--> statement-breakpoint
CREATE TABLE `vehicle_accessories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`catalog_id` integer,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`note` text,
	`value` integer,
	`check_on_handover` integer DEFAULT true NOT NULL,
	`show_in_share` integer DEFAULT false NOT NULL,
	`photo_file_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`removed_at` integer
);
--> statement-breakpoint
CREATE INDEX `vehicle_accessories_vehicle_idx` ON `vehicle_accessories` (`vehicle_id`);--> statement-breakpoint
ALTER TABLE `handovers` ADD `accessories` text DEFAULT '[]' NOT NULL;