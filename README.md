# OMP Provider Statusline

Show the complete `provider/model.id` of the active model in OMP's status line.

| Provider ID | Model ID | Status label |
| --- | --- | --- |
| `openai-codex` | `gpt-5.6-sol` | `openai-codex/gpt-5.6-sol` |
| `anthropic` | `claude-sonnet-4-6` | `anthropic/claude-sonnet-4-6` |

IDs are used verbatim, including every component of model IDs containing `/`. The label follows model switches within about a second and disappears while no model is selected.

## Installation (recommended)

```bash
omp plugin install github:hypn4/omp-provider-statusline
```

Restart OMP to load the plugin.

To update an existing installation:

```bash
omp plugin upgrade omp-provider-statusline
```

Restart OMP after upgrading; reloading a session does not reload extension code.

## Configuration

The label is an extension status (key `omp-provider-statusline`), shown next to other extensions' statuses:

- With `statusLine.showHookStatus` enabled (the default), it appears in the extension status row.
- To show it inside the bar, add the `status` segment to `statusLine.leftSegments` or `statusLine.rightSegments`.

The native `model` segment and the composer's model chip keep OMP's friendly model name with their thinking, fast, and advisor indicators. Remove `model` from your segments if you want only the full ID.

### Migrating from 0.2.x

0.2.x relabeled the native `model` segment through a segment registry that OMP 19.2.0 no longer exports; on 19.2.0 and later it only showed a compatibility warning. Upgrade the plugin and use the configuration above to place the label.

## Compatibility

Tested with OMP 19.2.1. No build step or additional runtime dependencies.

The plugin uses only the public extension API: `ctx.ui.setStatus` for the label and `ctx.setInterval` to notice model switches, because OMP emits no model-change event to extensions. It writes the status only when the label changes, never modifies session or model data, and runs only in the main interactive (TUI) session. Its timer and status are removed when the session shuts down.

## Development

```bash
bun install
bun test
omp plugin link .
```

## Uninstall

```bash
omp plugin uninstall omp-provider-statusline
```

Restart OMP.

## License

[MIT](LICENSE)
