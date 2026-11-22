// Managed-data migration. Schema 2 added the task lifecycle (sections, pin, unread, snooze,
// settle, archive, work sessions); schema 3 adds progress notes (updates) to tasks; schema 4 adds
// watching and turns pins into a label. Retry-safe: data already at schema 4 is validated and kept.
import { defineMigration } from "@toolbelt/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA, seed, upgrade1to2, upgrade2to3, upgrade3to4 } from "./model";
import { FILE, load, save } from "./store";

defineMigration(({ toSchema, fromSchema, targetDir, progress }) => {
	if (toSchema !== SCHEMA || !(fromSchema === null || fromSchema === 1 || fromSchema === 2 || fromSchema === 3 || fromSchema === SCHEMA)) throw Error(`Unsupported schema change ${fromSchema} → ${toSchema}`);
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
		raw = upgrade2to3(raw);
		progress("Tasks can now have updates");
	}
	if (raw?.schema === 3) {
		const pinned = Array.isArray(raw.tasks) && raw.tasks.some((t: { pinned?: boolean }) => t.pinned);
		save(targetDir, upgrade3to4(raw));
		progress("Tasks can now be watched");
		if (pinned) progress("Pinned tasks now carry the Pinned label");
		return;
	}
	load(targetDir);
	progress("Existing tasks kept");
});
