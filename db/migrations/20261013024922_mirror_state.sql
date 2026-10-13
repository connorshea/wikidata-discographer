CREATE TABLE `mirror_state` (
	`name` varchar(32) NOT NULL,
	`version` int NOT NULL,
	CONSTRAINT `mirror_state_name` PRIMARY KEY(`name`)
);
