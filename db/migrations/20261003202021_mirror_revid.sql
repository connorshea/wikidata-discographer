ALTER TABLE `music_items` ADD `revid` bigint;--> statement-breakpoint
ALTER TABLE `music_items` ADD `row_version` int DEFAULT 0 NOT NULL;--> statement-breakpoint
DROP INDEX `idx_music_items_last_dump` ON `music_items`;--> statement-breakpoint
ALTER TABLE `music_items` DROP COLUMN `last_dump`;