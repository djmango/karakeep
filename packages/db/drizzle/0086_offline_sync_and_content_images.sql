CREATE TABLE `syncEvents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text NOT NULL,
	`operation` text NOT NULL,
	`bookmarkId` text,
	`payload` text,
	`modifiedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `syncEvents_userId_id_idx` ON `syncEvents` (`userId`,`id`);--> statement-breakpoint
CREATE TABLE `syncAppliedOperations` (
	`operationId` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`appliedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `syncAppliedOperations_userId_idx` ON `syncAppliedOperations` (`userId`);--> statement-breakpoint
ALTER TABLE `bookmarkLinks` ADD `contentImageStatus` text;
