CREATE TABLE `music_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`qid` varchar(32) NOT NULL,
	`property` varchar(16) NOT NULL,
	`target` varchar(32) NOT NULL,
	CONSTRAINT `music_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_music_links_unique` UNIQUE(`qid`,`property`,`target`)
);
--> statement-breakpoint
CREATE INDEX `idx_music_links_target` ON `music_links` (`target`,`property`);