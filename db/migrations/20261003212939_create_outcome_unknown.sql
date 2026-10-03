ALTER TABLE `wikidata_edits` ADD `unknown` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `wikidata_edits` ADD `started_at` datetime;