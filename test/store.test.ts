import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addTask, seed } from "../src/model";
import { FILE, load, save } from "../src/store";

const temp = () => mkdtempSync(join(tmpdir(), "ontrack-store-"));

test("missing data loads the seed; saved data round-trips without temp files", () => {
	const dir = temp();
	try {
		expect(load(dir)).toEqual(seed());
		const d = seed();
		addTask(d, { name: "x", due: "", desc: "", labels: {} }, 1);
		save(dir, d);
		expect(load(dir)).toEqual(d);
		expect(readdirSync(dir)).toEqual([FILE]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a damaged file fails loudly", () => {
	const dir = temp();
	try {
		writeFileSync(join(dir, FILE), '{"schema":1}');
		expect(() => load(dir)).toThrow();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("migration seeds once and keeps existing data", async () => {
	const dir = temp();
	const migrate = async (from: number | null = null) => {
		const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/migrate.ts")], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
		p.stdin.write(JSON.stringify({ type: "migrate", transactionId: "t", fromVersion: null, toVersion: "0.0.1", fromSchema: from, toSchema: 2, sourceDir: dir, targetDir: dir }));
		p.stdin.end();
		expect(await p.exited).toBe(0);
		return (await new Response(p.stdout).text()).trim().split("\n").map((l) => JSON.parse(l));
	};
	try {
		expect((await migrate()).at(-1).type).toBe("migration-complete");
		expect(load(dir)).toEqual(seed());
		const d = load(dir);
		addTask(d, { name: "keep me", due: "", desc: "", labels: {} }, 1);
		save(dir, d);
		const second = await migrate();
		expect(second.map((m) => m.text).filter(Boolean)).toEqual(["Existing tasks kept"]);
		expect(load(dir).tasks[0]!.name).toBe("keep me");
		// Schema 1 data is upgraded in place.
		writeFileSync(join(dir, FILE), JSON.stringify({ ...seed(), schema: 1, order: undefined, tasks: [{ id: 1, name: "old", created: 1, updated: 1, desc: "", labels: {}, relations: [] }] }));
		expect((await migrate(1)).map((m) => m.text).filter(Boolean)).toEqual(["Tasks moved into Inbox and Settled"]);
		expect(load(dir).tasks[0]).toMatchObject({ name: "old", state: "inbox" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
