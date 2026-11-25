import { afterEach, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import providerStatusline from "../src/index";

const KEY = "omp-provider-statusline";
const RELAY = "relay: AUTO (ON) | relay-2 2/5";

type ModelFixture = { provider: string; id: string; name: string };
const gpt: ModelFixture = { provider: "openai-codex", id: "gpt-6.1-sol", name: "GPT-6.1 Sol" };
const haiku: ModelFixture = { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" };

interface HarnessOptions {
	model?: ModelFixture | undefined;
	hasUI?: boolean;
	mode?: string;
	kind?: "main" | "sub";
}

const stops: Array<() => void> = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

function harness(options: HarnessOptions = {}) {
	let model = "model" in options ? options.model : gpt;
	const statuses = new Map<string, string>([["relay", RELAY]]);
	const writes: Array<string | undefined> = [];
	const timers = new Map<number, () => void>();
	let nextTimer = 0;
	const ctx = {
		hasUI: options.hasUI ?? true,
		mode: options.mode ?? "tui",
		agent: { kind: options.kind ?? "main", id: "Main" },
		get model() {
			return model;
		},
		ui: {
			setStatus(key: string, text: string | undefined) {
				if (key === KEY) writes.push(text);
				if (text === undefined) statuses.delete(key);
				else statuses.set(key, text);
			},
			notify() {},
		},
		setInterval(callback: () => void) {
			timers.set(++nextTimer, callback);
			return nextTimer;
		},
		clearTimer(timer: number) {
			timers.delete(timer);
		},
	} as unknown as ExtensionContext;
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
	providerStatusline({
		on(name: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
			handlers.set(name, handler);
		},
	} as unknown as ExtensionAPI);
	const emit = (name: string) => handlers.get(name)?.({ type: name }, ctx);
	stops.push(() => emit("session_shutdown"));
	return {
		statuses,
		writes,
		timers,
		emit,
		label: () => statuses.get(KEY),
		setModel(next: ModelFixture | undefined) {
			model = next;
		},
		tick() {
			for (const callback of [...timers.values()]) callback();
		},
	};
}

test.each([
	["openai-codex", "gpt-6.1-sol", "openai-codex/gpt-6.1-sol"],
	["liner", "deepseek/deepseek-v4.1-flash-1017", "liner/deepseek/deepseek-v4.1-flash-1017"],
	["openrouter", "vendor/family/model:free", "openrouter/vendor/family/model:free"],
	["Claude gateway", "vendor/model$&", "Claude gateway/vendor/model$&"],
])("shows the complete %s/%s ID as its extension status", (provider, id, expected) => {
	const h = harness({ model: { provider, id, name: "Friendly Name" } });
	h.emit("session_start");
	expect(h.label()).toBe(expected);
});

test("follows a model change on the next sync without rewriting an unchanged label", () => {
	const h = harness();
	h.emit("session_start");
	h.setModel(haiku);
	h.tick();
	expect(h.label()).toBe("anthropic/claude-haiku-4-5");
	h.tick();
	h.tick();
	expect(h.writes).toEqual(["openai-codex/gpt-6.1-sol", "anthropic/claude-haiku-4-5"]);
});

test("shows nothing while no model is selected and clears the label when the model goes away", () => {
	const h = harness({ model: undefined });
	h.emit("session_start");
	expect(h.statuses.has(KEY)).toBe(false);
	h.setModel(gpt);
	h.tick();
	expect(h.label()).toBe("openai-codex/gpt-6.1-sol");
	h.setModel(undefined);
	h.tick();
	expect(h.statuses.has(KEY)).toBe(false);
});

test("keeps one sync timer across repeated lifecycle events", () => {
	const h = harness();
	for (const event of ["session_start", "session_switch", "session_branch", "session_tree", "session_start"]) {
		h.emit(event);
	}
	expect(h.timers.size).toBe(1);
	expect(h.writes).toEqual(["openai-codex/gpt-6.1-sol"]);
});

test("shutdown clears its timer and label, and the next session starts again", () => {
	const h = harness();
	h.emit("session_start");
	h.emit("session_shutdown");
	expect(h.timers.size).toBe(0);
	expect(h.statuses.has(KEY)).toBe(false);
	h.emit("session_shutdown");
	expect(h.writes).toEqual(["openai-codex/gpt-6.1-sol", undefined]);
	h.setModel(haiku);
	h.emit("session_start");
	expect(h.label()).toBe("anthropic/claude-haiku-4-5");
	expect(h.timers.size).toBe(1);
});

test("leaves other extensions' statuses untouched", () => {
	const h = harness();
	h.emit("session_start");
	h.setModel(haiku);
	h.tick();
	h.emit("session_shutdown");
	expect([...h.statuses.entries()]).toEqual([["relay", RELAY]]);
});

test.each([
	["without UI", { hasUI: false }],
	["in RPC mode", { mode: "rpc" }],
	["in a subagent session", { kind: "sub" as const }],
])("stays inactive %s", (_label, options) => {
	const h = harness(options);
	for (const event of ["session_start", "session_switch", "session_shutdown"]) h.emit(event);
	expect(h.writes).toEqual([]);
	expect(h.timers.size).toBe(0);
});
