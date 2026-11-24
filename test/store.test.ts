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
		p.stdin.write(JSON.stringify({ type: "migrate", transactionId: "t", fromVersion: null, toVersion: "0.0.1", fromSchema: from, toSchema: 6, sourceDir: dir, targetDir: dir }));
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
		writeFileSync(join(dir, FILE), JSON.stringify({ ...seed(), schema: 1, nextUpdateId: undefined, order: undefined, tasks: [{ id: 1, name: "old", created: 1, updated: 1, desc: "", labels: {}, relations: [] }] }));
		expect((await migrate(1)).map((m) => m.text).filter(Boolean)).toEqual(["Tasks moved into Inbox and Settled", "Tasks can now have updates", "Tasks can now be watched", "Label values now have colors of their own", "Filters and grouping are now saved"]);
		expect(load(dir).tasks[0]).toMatchObject({ name: "old", state: "inbox", updates: [] });
		expect(load(dir).nextUpdateId).toBe(1);
		// Schema 2 data gets updates.
		const two = { ...seed(), schema: 2, nextUpdateId: undefined, tasks: [{ ...load(dir).tasks[0], updates: undefined }] };
		writeFileSync(join(dir, FILE), JSON.stringify(two));
		expect((await migrate(2)).map((m) => m.text).filter(Boolean)).toEqual(["Tasks can now have updates", "Tasks can now be watched", "Label values now have colors of their own", "Filters and grouping are now saved"]);
		expect(load(dir)).toMatchObject({ schema: 6, nextUpdateId: 1, tasks: [{ name: "old", state: "inbox", updates: [] }] });
		// Schema 3 data can be watched.
		const three = load(dir);
		writeFileSync(join(dir, FILE), JSON.stringify({ ...three, schema: 3, order: { ...three.order, pinned: [] } }));
		expect((await migrate(3)).map((m) => m.text).filter(Boolean)).toEqual(["Tasks can now be watched", "Label values now have colors of their own", "Filters and grouping are now saved"]);
		expect(load(dir)).toMatchObject({ schema: 6, tasks: [{ name: "old", state: "inbox" }] });
		// Pins become the Pinned label.
		writeFileSync(join(dir, FILE), JSON.stringify({ ...three, schema: 3, order: { ...three.order, pinned: [1] }, tasks: three.tasks.map((t) => ({ ...t, pinned: true })) }));
		expect((await migrate(3)).map((m) => m.text).filter(Boolean)).toEqual(["Tasks can now be watched", "Pinned tasks now carry the Pinned label", "Label values now have colors of their own", "Filters and grouping are now saved"]);
		const after = load(dir);
		const label = after.labels.find((l) => l.name === "Pinned")!;
		expect(after.tasks[0]!.labels[label.id]).toBe(true);
		expect(after.order).toEqual({ inbox: three.order.inbox, working: three.order.working });
		// Schema 4 data: values get colors, and the seeded colors survive.
		writeFileSync(join(dir, FILE), JSON.stringify({ ...after, schema: 4 }));
		expect((await migrate(4)).map((m) => m.text).filter(Boolean)).toEqual(["Label values now have colors of their own", "Filters and grouping are now saved"]);
		expect(load(dir).labels).toEqual(after.labels);
		// Schema 5 data: the filter row is saved as the list looked, and archived tasks get a date.
		const { filters: _f, ...five } = load(dir);
		writeFileSync(join(dir, FILE), JSON.stringify({ ...five, schema: 5, tasks: [{ ...five.tasks[0], archived: true, updated: 42 }] }));
		expect((await migrate(5)).map((m) => m.text).filter(Boolean)).toEqual(["Filters and grouping are now saved"]);
		expect(load(dir).tasks[0]).toMatchObject({ archived: true, archivedAt: 42 });
		expect(load(dir).filters.slice(0, 2)).toEqual([{ id: "status", group: true, selected: ["inbox", "working", "snoozed", "watching", "settled"] }, { id: "due", group: false, selected: [] }]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
