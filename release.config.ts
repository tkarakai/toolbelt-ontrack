import { json, packagePlugin, run, updateJSONVersion, type ReleaseConfig } from "@toolbelt/sdk/release";

// Packages are probed as the Toolbelt version the pinned SDK matches (its `HOST_VERSION`).
export default {
	repo: "tkarakai/toolbelt-ontrack",
	products: {
		plugin: {
			changelog: "CHANGELOG.md",
			version: () => json("toolbelt.json").version,
			async setVersion(v) {
				await updateJSONVersion("package.json", v);
				await updateJSONVersion("toolbelt.json", v);
			},
			async build() {
				await run(["bun", "scripts/build.ts"]);
				// Built on Linux, installed on Macs: refuse names that differ only by letter case.
				await run(["bun", "scripts/check-case.ts", "--git", "dist/package"]);
				return packagePlugin("dist/package", "artifacts", undefined, []);
			},
		},
	},
} satisfies ReleaseConfig;
