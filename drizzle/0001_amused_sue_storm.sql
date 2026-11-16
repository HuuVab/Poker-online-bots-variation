CREATE TABLE `club_hands` (
	`id` text PRIMARY KEY NOT NULL,
	`table_code` text NOT NULL,
	`hand` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `club_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`table_code` text,
	`wallet_delta` integer NOT NULL,
	`table_delta` integer NOT NULL,
	`wallet_after` integer NOT NULL,
	`stack_after` integer,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `club_operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `club_operation_unique` ON `club_operations` (`actor_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `club_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clubs` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`version` integer NOT NULL,
	`last_commit` text NOT NULL,
	`updated_at` integer NOT NULL
);
