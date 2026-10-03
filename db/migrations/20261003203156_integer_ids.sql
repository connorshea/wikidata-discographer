-- Store item and property IDs as numbers (Q123 → 123, P175 → 175).
-- The mirror is rebuilt from the dump, so it's emptied rather than converted;
-- the next import refills it. Run history is converted in place.
TRUNCATE TABLE `music_items`;--> statement-breakpoint
TRUNCATE TABLE `music_external_ids`;--> statement-breakpoint
ALTER TABLE `music_external_ids` DROP INDEX `idx_music_external_ids_unique`;--> statement-breakpoint
ALTER TABLE `music_external_ids` DROP COLUMN `id`;--> statement-breakpoint
ALTER TABLE `music_external_ids` MODIFY COLUMN `qid` bigint unsigned NOT NULL;--> statement-breakpoint
ALTER TABLE `music_external_ids` MODIFY COLUMN `property` int unsigned NOT NULL;--> statement-breakpoint
ALTER TABLE `music_external_ids` ADD PRIMARY KEY(`qid`,`property`,`value`);--> statement-breakpoint
ALTER TABLE `music_items` MODIFY COLUMN `qid` bigint unsigned NOT NULL;--> statement-breakpoint
UPDATE `submissions` SET `album_qid` = SUBSTRING(`album_qid`, 2) WHERE `album_qid` LIKE 'Q%';--> statement-breakpoint
ALTER TABLE `submissions` MODIFY COLUMN `album_qid` bigint unsigned;--> statement-breakpoint
UPDATE `wikidata_edits` SET `qid` = SUBSTRING(`qid`, 2) WHERE `qid` LIKE 'Q%';--> statement-breakpoint
ALTER TABLE `wikidata_edits` MODIFY COLUMN `qid` bigint unsigned;
