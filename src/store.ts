// Persists OnTrack's data as one JSON document in the plugin's managed data directory.
// Writes go to a temporary file that is renamed into place, so a crash never leaves half a file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseData, seed, type Data } from "./model";

export const FILE = "ontrack.json";

export function load(dir: string): Data {
	const file = join(dir, FILE);
	if (!existsSync(file)) return seed();
	return parseData(JSON.parse(readFileSync(file, "utf8")));
}

export function save(dir: string, data: Data) {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, FILE);
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, "\t"));
	renameSync(tmp, file);
}
