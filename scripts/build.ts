// Bundles the plugin and its migration into dist/package, the archive root, with its assets.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const out = "dist/package";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [entry, file] of [["src/index.ts", "index.js"], ["src/migrate.ts", "migrate.js"]] as const) {
	const result = await Bun.build({ entrypoints: [entry], target: "bun" });
	if (!result.success) throw new AggregateError(result.logs, `Building ${entry} failed`);
	await Bun.write(`${out}/${file}`, result.outputs[0]!);
}
writeFileSync(`${out}/toolbelt.json`, readFileSync("toolbelt.json"));
// The state icons (manifest `assets`): monochrome SVGs Toolbelt tints with the text color.
cpSync("assets", `${out}/assets`, { recursive: true });
writeFileSync(`${out}/NOTICE`, "OnTrack by Tamas Karakai. The public Toolbelt SDK is bundled.\n");
