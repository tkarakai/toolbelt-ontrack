// Initializes managed data for schema 1: seeds the default labels and relation types once.
// Retry-safe: existing data is validated and left alone.
import { defineMigration } from "@toolbelt/sdk";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA, seed } from "./model";
import { FILE, load, save } from "./store";

defineMigration(({ toSchema, fromSchema, targetDir, progress }) => {
	if (toSchema !== SCHEMA || !(fromSchema === null || fromSchema === SCHEMA)) throw Error(`Unsupported schema change ${fromSchema} → ${toSchema}`);
	if (existsSync(join(targetDir, FILE))) {
		load(targetDir);
		progress("Existing tasks kept");
		return;
	}
	save(targetDir, seed());
	progress("Default labels created");
});
