import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const STATUS_KEY = "omp-provider-statusline";
// OMP emits no model-change event to extensions, so the live model is compared
// on this interval; the status is rewritten only when the label changes.
const SYNC_INTERVAL_MS = 1_000;

interface ActiveStatus {
	ctx: ExtensionContext;
	clearTimer(): void;
	label: string | undefined;
}

/** Show the complete `provider/model.id` as this plugin's extension status. */
export default function providerStatusline(api: ExtensionAPI): void {
	let active: ActiveStatus | undefined;

	function sync(): void {
		if (!active) return;
		const model = active.ctx.model;
		const label = model ? `${model.provider}/${model.id}` : undefined;
		if (label === active.label) return;
		active.label = label;
		active.ctx.ui.setStatus(STATUS_KEY, label);
	}

	function stop(): void {
		if (!active) return;
		const { ctx, clearTimer, label } = active;
		active = undefined;
		clearTimer();
		if (label !== undefined) ctx.ui.setStatus(STATUS_KEY, undefined);
	}

	function start(_event: unknown, ctx: ExtensionContext): void {
		if (!ctx.hasUI || ctx.mode !== "tui" || ctx.agent.kind !== "main") {
			stop();
			return;
		}
		if (active) {
			active.ctx = ctx;
		} else {
			const timer = ctx.setInterval(sync, SYNC_INTERVAL_MS);
			active = { ctx, clearTimer: () => ctx.clearTimer(timer), label: undefined };
		}
		sync();
	}

	api.on("session_start", start);
	api.on("session_switch", start);
	api.on("session_branch", start);
	api.on("session_tree", start);
	api.on("session_shutdown", stop);
}
