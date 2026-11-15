// Managed-data migration. Schema 2 adds the task lifecycle (sections, pin, unread, snooze,
// settle, archive, work sessions). Retry-safe: data already at schema 2 is validated and kept.
import { defineMigration } from "@toolbelt/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA, seed, upgrade1to2 } from "./model";
import { FILE, load, save } from "./store";

defineMigration(({ toSchema, fromSchema, targetDir, progress }) => {
	if (toSchema !== SCHEMA || !(fromSchema === null || fromSchema === 1 || fromSchema === SCHEMA)) throw Error(`Unsupported schema change ${fromSchema} → ${toSchema}`);
	const file = join(targetDir, FILE);
	if (!existsSync(file)) {
		save(targetDir, seed());
		progress("Default labels created");
		return;
	}
	const raw = JSON.parse(readFileSync(file, "utf8"));
	if (raw?.schema === 1) {
		save(targetDir, upgrade1to2(raw));
		progress("Tasks moved into Inbox and Settled");
		return;
	}
	load(targetDir);
	progress("Existing tasks kept");
});
