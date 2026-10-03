CREATE TABLE `music_links` (
	`qid` bigint unsigned NOT NULL,
	`property` int unsigned NOT NULL,
	`target` bigint unsigned NOT NULL,
	CONSTRAINT `music_links_qid_property_target_pk` PRIMARY KEY(`qid`,`property`,`target`)
);
--> statement-breakpoint
CREATE INDEX `idx_music_links_target` ON `music_links` (`target`,`property`);--> statement-breakpoint
-- labelSearchKey (server/mirror.ts) now makes curly quotes straight. Do the
-- same to the stored keys, so search and duplicate checks match them before
-- the next import rewrites every row.
UPDATE `music_items` SET `label_search` = REPLACE(REPLACE(REPLACE(REPLACE(`label_search`, '’', ''''), '‘', ''''), '“', '"'), '”', '"') WHERE `label_search` LIKE '%’%' OR `label_search` LIKE '%‘%' OR `label_search` LIKE '%“%' OR `label_search` LIKE '%”%';
