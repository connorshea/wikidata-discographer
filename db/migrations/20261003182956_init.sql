CREATE TABLE `music_external_ids` (
	`id` int AUTO_INCREMENT NOT NULL,
	`qid` varchar(32) NOT NULL,
	`property` varchar(16) NOT NULL,
	`value` varchar(400) NOT NULL,
	CONSTRAINT `music_external_ids_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_music_external_ids_unique` UNIQUE(`qid`,`property`,`value`)
);
--> statement-breakpoint
CREATE TABLE `music_items` (
	`qid` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`label` varchar(400),
	`label_search` varchar(191),
	`description` varchar(400),
	`instance_of` json NOT NULL,
	`last_dump` varchar(32),
	`source` varchar(8) NOT NULL DEFAULT 'dump',
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `music_items_qid` PRIMARY KEY(`qid`)
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`user_id` int NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`access_expires_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `oauth_tokens_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`last_seen_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`expires_at` datetime NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`edit_group` varchar(32) NOT NULL,
	`status` varchar(16) NOT NULL,
	`title` varchar(400) NOT NULL,
	`album_qid` varchar(32),
	`input` json NOT NULL,
	`error` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`finished_at` datetime,
	CONSTRAINT `submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int NOT NULL,
	`username` varchar(255) NOT NULL,
	`blocked` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`last_login_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wikidata_edits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`submission_id` int NOT NULL,
	`user_id` int NOT NULL,
	`op` varchar(16) NOT NULL,
	`key` varchar(64),
	`kind` varchar(16),
	`what` varchar(400) NOT NULL,
	`qid` varchar(32),
	`revid` bigint,
	`ok` boolean NOT NULL,
	`skipped` int NOT NULL DEFAULT 0,
	`error_code` varchar(64),
	`error_text` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `wikidata_edits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `oauth_tokens` ADD CONSTRAINT `oauth_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wikidata_edits` ADD CONSTRAINT `wikidata_edits_submission_id_submissions_id_fk` FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wikidata_edits` ADD CONSTRAINT `wikidata_edits_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_music_external_ids_lookup` ON `music_external_ids` (`property`,`value`);--> statement-breakpoint
CREATE INDEX `idx_music_items_label_search` ON `music_items` (`label_search`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_music_items_last_dump` ON `music_items` (`last_dump`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_submissions_user_id` ON `submissions` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_wikidata_edits_submission` ON `wikidata_edits` (`submission_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_wikidata_edits_user` ON `wikidata_edits` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_wikidata_edits_qid` ON `wikidata_edits` (`qid`);