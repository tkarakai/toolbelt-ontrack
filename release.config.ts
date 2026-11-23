import { json, packagePlugin, run, updateJSONVersion, type ReleaseConfig } from "@toolbelt/sdk/release";

/** The Toolbelt version packages are checked against: the minimum this plugin requires. */
const HOST_VERSION = "0.3.14";

export default {
	repo: "tkarakai/toolbelt-ontrack",
	hostVersion: HOST_VERSION,
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
				return packagePlugin("dist/package", "artifacts", HOST_VERSION, []);
			},
		},
	},
} satisfies ReleaseConfig;
