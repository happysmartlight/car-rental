CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`entity` text,
	`entity_id` text,
	`detail` text,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE TABLE `charges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rental_id` integer NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`auto` integer DEFAULT false NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `charges_rental_idx` ON `charges` (`rental_id`);--> statement-breakpoint
CREATE TABLE `collaterals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rental_id` integer NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`photo_file_ids` text NOT NULL,
	`received_at` integer NOT NULL,
	`returned_at` integer,
	`notes` text,
	`created_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collaterals_rental_idx` ON `collaterals` (`rental_id`);--> statement-breakpoint
CREATE TABLE `contract_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`file_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`builtin` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text NOT NULL,
	`id_number` text,
	`old_id_number` text,
	`id_card_type` text,
	`dob` text,
	`gender` text,
	`id_issue_date` text,
	`id_issue_place` text,
	`permanent_address` text,
	`current_address` text,
	`phone` text,
	`phone2` text,
	`zalo` text,
	`email` text,
	`occupation` text,
	`license_number` text,
	`license_class` text,
	`license_expiry` text,
	`emergency_name` text,
	`emergency_phone` text,
	`emergency_relation` text,
	`notes` text,
	`blacklisted` integer DEFAULT false NOT NULL,
	`blacklist_reason` text,
	`id_front_file_id` text,
	`id_back_file_id` text,
	`license_front_file_id` text,
	`license_back_file_id` text,
	`portrait_file_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_id_number_unique` ON `customers` (`id_number`);--> statement-breakpoint
CREATE INDEX `customers_phone_idx` ON `customers` (`phone`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rental_id` integer NOT NULL,
	`template_id` integer,
	`template_name` text NOT NULL,
	`template_version` integer NOT NULL,
	`kind` text NOT NULL,
	`docx_file_id` text NOT NULL,
	`pdf_file_id` text,
	`sha256` text NOT NULL,
	`data` text NOT NULL,
	`scan_file_ids` text NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_rental_idx` ON `documents` (`rental_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`path` text NOT NULL,
	`thumb_path` text,
	`original_name` text,
	`sha256` text NOT NULL,
	`taken_at` integer,
	`created_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `handovers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rental_id` integer NOT NULL,
	`kind` text NOT NULL,
	`vehicle_id` integer NOT NULL,
	`at` integer NOT NULL,
	`odo` integer NOT NULL,
	`fuel_level` integer NOT NULL,
	`checklist` text NOT NULL,
	`photos` text NOT NULL,
	`damages` text NOT NULL,
	`notes` text,
	`signature_file_id` text,
	`staff_user_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `handovers_rental_idx` ON `handovers` (`rental_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rental_id` integer NOT NULL,
	`direction` text NOT NULL,
	`purpose` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`at` integer NOT NULL,
	`note` text,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`voided_at` integer,
	`void_reason` text
);
--> statement-breakpoint
CREATE INDEX `payments_rental_idx` ON `payments` (`rental_id`);--> statement-breakpoint
CREATE TABLE `reminder_log` (
	`key` text PRIMARY KEY NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rental_drivers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rental_id` integer NOT NULL,
	`customer_id` integer NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rental_drivers_uq` ON `rental_drivers` (`rental_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `rental_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rental_id` integer NOT NULL,
	`vehicle_id` integer NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `segments_vehicle_idx` ON `rental_segments` (`vehicle_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `segments_rental_idx` ON `rental_segments` (`rental_id`);--> statement-breakpoint
CREATE TABLE `rentals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`type` text DEFAULT 'self_drive' NOT NULL,
	`status` text NOT NULL,
	`customer_id` integer NOT NULL,
	`vehicle_id` integer NOT NULL,
	`scheduled_start` integer NOT NULL,
	`scheduled_end` integer NOT NULL,
	`actual_start` integer,
	`actual_end` integer,
	`pickup_method` text DEFAULT 'at_shop' NOT NULL,
	`pickup_location` text,
	`return_location` text,
	`pricing` text NOT NULL,
	`km_limit` integer DEFAULT 0 NOT NULL,
	`deposit_required` integer DEFAULT 0 NOT NULL,
	`fine_hold_amount` integer DEFAULT 0 NOT NULL,
	`fine_hold_until` integer,
	`notes` text,
	`cancel_reason` text,
	`created_by` integer,
	`handled_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rentals_code_unique` ON `rentals` (`code`);--> statement-breakpoint
CREATE INDEX `rentals_vehicle_idx` ON `rentals` (`vehicle_id`,`scheduled_start`);--> statement-breakpoint
CREATE INDEX `rentals_customer_idx` ON `rentals` (`customer_id`);--> statement-breakpoint
CREATE INDEX `rentals_status_idx` ON `rentals` (`status`);--> statement-breakpoint
CREATE TABLE `sequences` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`user_agent` text,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `traffic_fines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer,
	`plate` text NOT NULL,
	`plate_key` text NOT NULL,
	`violated_at` integer NOT NULL,
	`location` text,
	`violation` text,
	`amount` integer,
	`source` text DEFAULT 'csgt' NOT NULL,
	`notice_file_id` text,
	`rental_id` integer,
	`customer_id` integer,
	`status` text DEFAULT 'new' NOT NULL,
	`notes` text,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fines_plate_idx` ON `traffic_fines` (`plate_key`,`violated_at`);--> statement-breakpoint
CREATE INDEX `fines_customer_idx` ON `traffic_fines` (`customer_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `vehicle_blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`kind` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer,
	`location` text,
	`notes` text,
	`created_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `blocks_vehicle_idx` ON `vehicle_blocks` (`vehicle_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plate` text NOT NULL,
	`plate_key` text NOT NULL,
	`make` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`year` integer,
	`color` text,
	`seats` integer,
	`transmission` text,
	`fuel` text,
	`vin` text,
	`engine_no` text,
	`odo` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`owner_type` text DEFAULT 'own' NOT NULL,
	`owner_name` text,
	`owner_phone` text,
	`owner_share_pct` integer,
	`price_day` integer DEFAULT 0 NOT NULL,
	`price_hour` integer DEFAULT 0 NOT NULL,
	`price_weekend_day` integer,
	`km_limit_day` integer DEFAULT 0 NOT NULL,
	`over_km_fee` integer DEFAULT 0 NOT NULL,
	`over_hour_fee` integer DEFAULT 0 NOT NULL,
	`deposit_amount` integer DEFAULT 0 NOT NULL,
	`inspection_expiry` text,
	`insurance_tnds_expiry` text,
	`insurance_body_expiry` text,
	`road_fee_expiry` text,
	`next_service_odo` integer,
	`next_service_date` text,
	`photo_file_id` text,
	`registration_file_id` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_plate_key_unique` ON `vehicles` (`plate_key`);