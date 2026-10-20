import { afterEach, beforeAll, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { SEGMENTS } from "@oh-my-pi/pi-tui/status-line/segments";
import type { SegmentContext } from "@oh-my-pi/pi-tui/status-line/types";
import { initThemeSync } from "@oh-my-pi/pi-tui/theme";
import providerStatusline from "../src/index";

const original = SEGMENTS.model;
const cleanups: Array<() => void> = [];

type ModelFixture = { provider: string; id: string; name: string; thinking: boolean };
const gpt = Object.freeze({
	provider: "openai-codex", id: "gpt-6.1-sol", name: "GPT-6.1 Sol", thinking: true,
});

class SessionFixture {
	#state: { model: ModelFixture | undefined; thinkingLevel: string };
	#auto = false;
	#fast = true;
	sessionManager = { getSessionName: () => "test" };

	constructor(model: ModelFixture | undefined = gpt) {
		this.#state = Object.freeze({ model, thinkingLevel: "high" });
	}
	get state() { return this.#state; }
	get isAutoThinking() { return this.#auto; }
	setAuto(value: boolean) { this.#auto = value; }
	setModel(model: ModelFixture | undefined) {
		this.#state = Object.freeze({ model, thinkingLevel: "high" });
	}
	isFastModeActive() { return this.#fast; }
	autoResolvedThinkingLevel() { return this.#auto ? "high" : undefined; }
	getAdvisorStatusOverview() {
		return { configured: true, advisors: [{ status: "quota_exhausted", yielded: false }] };
	}
	getAnthropicSlowModeLabel() { return "low priority"; }
}

function context(session: SessionFixture, patch: Partial<SegmentContext> = {}): SegmentContext {
	return {
		session, width: 120, options: { model: { showThinkingLevel: true } },
		compactThinkingLevel: false, sessionAccent: false,
		...patch,
	} as unknown as SegmentContext;
}

function harness(
	session = new SessionFixture(),
	overrides: Partial<ExtensionContext> = {},
	sdk: unknown = { SEGMENTS },
) {
	const handlers = new Map<string, Function>();
	const statuses = new Map<string, string>([["relay", "relay: AUTO (ON) | relay-2 2/5"]]);
	const notices: string[] = [];
	let timers = 0;
	const ctx = {
		hasUI: true, mode: "tui", agent: { kind: "main" },
		models: { current: () => session.state.model },
		ui: {
			setStatus(key: string, value: string | undefined) {
				if (value === undefined) statuses.delete(key);
				else statuses.set(key, value);
			},
			notify(message: string) { notices.push(message); },
		},
		setInterval() { timers++; return timers; },
		clearTimer() { timers--; },
		...overrides,
	} as unknown as ExtensionContext;
	const api = {
		pi: sdk,
		on(name: string, fn: Function) { handlers.set(name, fn); },
		getThinkingLevel: () => session.state.thinkingLevel,
	} as unknown as ExtensionAPI;
	providerStatusline(api);
	const emit = (name: string) => handlers.get(name)?.({}, ctx);
	const stop = () => emit("session_shutdown");
	cleanups.push(stop);
	return { session, statuses, notices, emit, stop, timers: () => timers };
}

beforeAll(() => initThemeSync("unicode", false, "dark", "light"));
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	SEGMENTS.model = original;
});

test("native render and describe replace only the label and preserve frozen session data", () => {
	const h = harness();
	const ctx = context(h.session);
	const beforeState = h.session.state;
	const beforeModel = beforeState.model;
	const ansi = original.render(ctx);
	const native = original.describe(ctx)!;
	h.emit("session_start");

	expect(SEGMENTS.model.render(ctx)).toEqual({
		...ansi, content: ansi.content.replace("GPT-6.1 Sol", "openai-codex/gpt-6.1-sol"),
	});
	expect(SEGMENTS.model.describe(ctx)).toEqual({
		...native,
		spans: native.spans.map((span, index) =>
			index === 0 ? { ...span, t: "openai-codex/gpt-6.1-sol" } : span),
	});
	expect(h.session.state).toBe(beforeState);
	expect(h.session.state.model).toBe(beforeModel);
	expect(h.session.state.model?.name).toBe("GPT-6.1 Sol");
});

test.each([
	["liner", "deepseek/deepseek-v4.1-flash-1017", "DeepSeek V4.1 Flash 1017 (Liner)",
		"liner/deepseek/deepseek-v4.1-flash-1017"],
	["anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6", "anthropic/claude-sonnet-4-6"],
	["openrouter", "vendor/family/model:free", "Friendly Name", "openrouter/vendor/family/model:free"],
	["Claude gateway", "vendor/model$&", "Claude Friendly Name", "Claude gateway/vendor/model$&"],
])("preserves complete IDs for %s", (provider, id, name, expected) => {
	const h = harness(new SessionFixture(Object.freeze({ provider, id, name, thinking: true })));
	h.emit("session_start");
	expect(SEGMENTS.model.describe(context(h.session))?.spans[0]?.t).toBe(expected);
	expect(SEGMENTS.model.render(context(h.session)).content).toContain(expected);
});

test("native compact, automatic thinking, and hidden thinking remain unchanged", () => {
	const h = harness();
	h.session.setAuto(true);
	h.emit("session_start");
	for (const patch of [
		{ compactThinkingLevel: true },
		{ compactThinkingLevel: false },
		{ options: { model: { showThinkingLevel: false } } },
	]) {
		const ctx = context(h.session, patch);
		const expected = original.render(ctx);
		expect(SEGMENTS.model.render(ctx)).toEqual({
			...expected,
			content: expected.content.replace("GPT-6.1 Sol", "openai-codex/gpt-6.1-sol"),
		});
		const native = original.describe(ctx)!;
		expect(SEGMENTS.model.describe(ctx)).toEqual({
			...native,
			spans: native.spans.map((span, index) =>
				index === 0 ? { ...span, t: "openai-codex/gpt-6.1-sol" } : span),
		});
	}
});

test("reads the live native model on the next render without polling", () => {
	const h = harness();
	h.emit("session_start");
	for (const event of ["session_switch", "session_branch", "session_tree", "session_start"]) {
		h.emit(event);
	}
	h.session.setModel({ provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", thinking: false });
	expect(SEGMENTS.model.describe(context(h.session))?.spans[0]?.t).toBe("anthropic/claude-haiku-4-5");
	expect(h.timers()).toBe(0);
});

test("keeps extension status independent and clears only its own legacy status", () => {
	const h = harness();
	h.statuses.set("omp-provider-statusline", "stale/model");
	const relay = "relay: AUTO (ON) | relay-2 2/5";
	h.emit("session_start");
	const ctx = context(h.session, { hookStatuses: [...h.statuses.values()] });
	expect([...h.statuses.entries()]).toEqual([["relay", relay]]);
	expect(SEGMENTS.status.describe(ctx)?.spans[0]?.t).toBe(relay);
	expect(SEGMENTS.model.describe(ctx)?.spans[0]?.t).toBe("openai-codex/gpt-6.1-sol");
});

test("keeps the native no-model rendering", () => {
	const h = harness();
	h.session.setModel(undefined);
	const ctx = context(h.session);
	h.emit("session_start");
	expect(SEGMENTS.model.render(ctx)).toEqual(original.render(ctx));
	expect(SEGMENTS.model.describe(ctx)).toEqual(original.describe(ctx));
});

test("shares the hook between UI owners and restores the original after the last owner", () => {
	const first = harness();
	const second = harness();
	first.emit("session_start");
	const hooked = SEGMENTS.model;
	second.emit("session_start");
	expect(SEGMENTS.model).toBe(hooked);
	first.stop();
	expect(SEGMENTS.model.describe(context(second.session))?.spans[0]?.t)
		.toBe("openai-codex/gpt-6.1-sol");
	second.stop();
	expect(SEGMENTS.model).toBe(original);
});

test("keeps repeated lifecycle events idempotent and can reinstall after shutdown", () => {
	const h = harness();
	h.emit("session_start");
	const hooked = SEGMENTS.model;
	for (const event of ["session_start", "session_switch", "session_branch", "session_tree"]) {
		h.emit(event);
		expect(SEGMENTS.model).toBe(hooked);
	}
	h.stop();
	h.stop();
	expect(SEGMENTS.model).toBe(original);
	h.emit("session_start");
	expect(SEGMENTS.model.describe(context(h.session))?.spans[0]?.t).toBe("openai-codex/gpt-6.1-sol");
	h.stop();
	expect(SEGMENTS.model).toBe(original);
	const next = harness();
	next.emit("session_start");
	expect(SEGMENTS.model.describe(context(next.session))?.spans[0]?.t).toBe("openai-codex/gpt-6.1-sol");
	next.stop();
	expect(SEGMENTS.model).toBe(original);
});

test("deactivates its projection without removing a later extension's renderer", () => {
	const h = harness();
	h.emit("session_start");
	const inner = SEGMENTS.model;
	const later = {
		...inner,
		render(ctx: SegmentContext) {
			const value = inner.render(ctx);
			return { ...value, content: "other: " + value.content };
		},
	};
	SEGMENTS.model = later;
	h.stop();
	expect(SEGMENTS.model).toBe(later);
	const ctx = context(h.session);
	expect(SEGMENTS.model.render(ctx).content).toBe("other: " + original.render(ctx).content);
	expect(SEGMENTS.model.describe(ctx)).toEqual(original.describe(ctx));
});

test.each([
	{ hasUI: false },
	{ mode: "rpc" },
	{ agent: { kind: "subagent" } },
])("does not change the native renderer for a non-main-TUI context", (override) => {
	const h = harness(new SessionFixture(), override as Partial<ExtensionContext>);
	h.emit("session_start");
	expect(SEGMENTS.model).toBe(original);
});

test("leaves unsupported hosts alone and reports the missing native hook", () => {
	const h = harness(new SessionFixture(), {}, {});
	h.emit("session_start");
	expect(SEGMENTS.model).toBe(original);
	expect(h.notices.length).toBe(1);
	expect([...h.statuses.keys()]).toEqual(["relay"]);
});
