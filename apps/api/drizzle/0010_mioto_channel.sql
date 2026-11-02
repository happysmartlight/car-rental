ALTER TABLE `cash_entries` ADD `rental_id` integer;--> statement-breakpoint
ALTER TABLE `contract_templates` ADD `channel` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `license_issue_place` text;--> statement-breakpoint
ALTER TABLE `rentals` ADD `channel` text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE `rentals` ADD `channel_ref` text;--> statement-breakpoint
ALTER TABLE `rentals` ADD `channel_price` integer;--> statement-breakpoint
ALTER TABLE `rentals` ADD `channel_day_price` integer;--> statement-breakpoint
ALTER TABLE `rentals` ADD `channel_fee_pct` integer;--> statement-breakpoint
ALTER TABLE `rentals` ADD `channel_fee` integer;--> statement-breakpoint
ALTER TABLE `rentals` ADD `channel_payout` integer;--> statement-breakpoint
ALTER TABLE `rentals` ADD `channel_paid_at` integer;--> statement-breakpoint
ALTER TABLE `rentals` ADD `source` text;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `reg_number` text;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `reg_date` text;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `reg_place` text;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `reg_owner` text;