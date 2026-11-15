// Managed-data migration. Schema 2 added the task lifecycle (sections, pin, unread, snooze,
// settle, archive, work sessions); schema 3 adds progress notes (updates) to tasks.
// Retry-safe: data already at schema 3 is validated and kept.
import { defineMigration } from "@toolbelt/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA, seed, upgrade1to2, upgrade2to3 } from "./model";
import { FILE, load, save } from "./store";

defineMigration(({ toSchema, fromSchema, targetDir, progress }) => {
	if (toSchema !== SCHEMA || !(fromSchema === null || fromSchema === 1 || fromSchema === 2 || fromSchema === SCHEMA)) throw Error(`Unsupported schema change ${fromSchema} → ${toSchema}`);
	const file = join(targetDir, FILE);
	if (!existsSync(file)) {
		save(targetDir, seed());
		progress("Default labels created");
		return;
	}
	let raw = JSON.parse(readFileSync(file, "utf8"));
	if (raw?.schema === 1) {
		raw = upgrade1to2(raw);
		progress("Tasks moved into Inbox and Settled");
	}
	if (raw?.schema === 2) {
		save(targetDir, upgrade2to3(raw));
		progress("Tasks can now have updates");
		return;
	}
	load(targetDir);
	progress("Existing tasks kept");
});
