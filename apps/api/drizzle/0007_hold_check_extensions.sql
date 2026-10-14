CREATE TABLE `rental_extensions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rental_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`old_end` integer NOT NULL,
	`new_end` integer NOT NULL,
	`old_total` integer NOT NULL,
	`new_total` integer NOT NULL,
	`old_km_limit` integer DEFAULT 0 NOT NULL,
	`new_km_limit` integer DEFAULT 0 NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `extensions_rental_idx` ON `rental_extensions` (`rental_id`);--> statement-breakpoint
ALTER TABLE `rentals` ADD `fine_checked_at` integer;--> statement-breakpoint
ALTER TABLE `rentals` ADD `fine_check_found` integer;