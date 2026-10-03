CREATE TABLE `music_links` (
	`qid` bigint unsigned NOT NULL,
	`property` int unsigned NOT NULL,
	`target` bigint unsigned NOT NULL,
	CONSTRAINT `music_links_qid_property_target_pk` PRIMARY KEY(`qid`,`property`,`target`)
);
--> statement-breakpoint
CREATE INDEX `idx_music_links_target` ON `music_links` (`target`,`property`);