import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

type SegmentRegistry = ExtensionAPI["pi"]["SEGMENTS"];
type ModelSegment = SegmentRegistry["model"];
type SegmentContext = Parameters<ModelSegment["render"]>[0];

const LEGACY_STATUS_KEY = "omp-provider-statusline";
const HOOK = Symbol.for("omp-provider-statusline.native-model.v1");
// The native renderer normalizes friendly names (for example, removing "Claude ").
// A temporary label keeps arbitrary provider/model IDs literal in both render paths.
const LABEL = "__omp_provider_statusline_model_label__";

interface HookController {
	version: 1;
	segment: ModelSegment;
	acquire(owner: symbol): () => void;
}

function projectLabel(ctx: SegmentContext) {
	const state = ctx.session.state;
	const model = state.model;
	if (!model) return undefined;

	const projectedState = { ...state, model: { ...model, name: LABEL } };
	const session = new Proxy(ctx.session, {
		get(target, key) {
			if (key === "state") return projectedState;
			// Native session getters and methods may access private class fields.
			const value = Reflect.get(target, key, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return { context: { ...ctx, session }, label: `${model.provider}/${model.id}` };
}

function acquireHook(registry: SegmentRegistry, owner: symbol): () => void {
	const original = registry.model;
	const existing = (original as ModelSegment & { [HOOK]?: HookController })[HOOK];
	if (existing?.version === 1 && existing.segment === original && typeof existing.acquire === "function") {
		return existing.acquire(owner);
	}

	const owners = new Set<symbol>();
	const wrapper: ModelSegment = {
		...original,
		render(ctx) {
			const projected = owners.size > 0 ? projectLabel(ctx) : undefined;
			const result = original.render.call(original, projected?.context ?? ctx);
			return projected
				? { ...result, content: result.content.replaceAll(LABEL, () => projected.label) }
				: result;
		},
		describe(ctx) {
			const projected = owners.size > 0 ? projectLabel(ctx) : undefined;
			const result = original.describe.call(original, projected?.context ?? ctx);
			if (!projected || !result) return result;
			return {
				...result,
				spans: result.spans.map(span =>
					span.t.includes(LABEL) ? { ...span, t: span.t.replaceAll(LABEL, () => projected.label) } : span),
			};
		},
	};
	const controller: HookController = {
		version: 1,
		segment: wrapper,
		acquire(token) {
			owners.add(token);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				owners.delete(token);
				// A later extension may wrap ours. Leave its registry entry intact;
				// our captured wrapper becomes a pass-through when the last owner exits.
				if (owners.size === 0 && registry.model === wrapper) registry.model = original;
			};
		},
	};
	Object.defineProperty(wrapper, HOOK, { value: controller });
	registry.model = wrapper;
	return controller.acquire(owner);
}

/** Show full provider/model IDs through OMP's native model segment. */
export default function providerStatusline(api: ExtensionAPI): void {
	const owner = Symbol("omp-provider-statusline");
	let release: (() => void) | undefined;
	let warned = false;

	function stop(): void {
		release?.();
		release = undefined;
	}

	function start(_event: unknown, ctx: ExtensionContext): void {
		if (!ctx.hasUI || ctx.mode !== "tui" || ctx.agent.kind !== "main") {
			stop();
			return;
		}
		// Remove only this plugin's old status entry when upgrading from 0.1.x.
		ctx.ui.setStatus(LEGACY_STATUS_KEY, undefined);
		if (release) return;

		// Use the host-injected SDK: importing another copy of pi-tui could hook
		// a different registry from the one used by OMP's bundled UI.
		const registry = api.pi?.SEGMENTS;
		if (!registry?.model || typeof registry.model.render !== "function"
			|| typeof registry.model.describe !== "function") {
			if (!warned) {
				ctx.ui.notify("Provider Statusline: this OMP version does not expose a compatible native model segment.", "warning");
				warned = true;
			}
			return;
		}
		release = acquireHook(registry, owner);
	}

	api.on("session_start", start);
	api.on("session_switch", start);
	api.on("session_branch", start);
	api.on("session_tree", start);
	api.on("session_shutdown", stop);
}
