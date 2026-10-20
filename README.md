# OMP Provider Statusline

Show the complete `provider/model.id` in OMP's native `model` segment.

| Provider ID | Model ID | Model segment label |
| --- | --- | --- |
| `openai-codex` | `gpt-5.6-sol` | `openai-codex/gpt-5.6-sol` |
| `anthropic` | `claude-sonnet-4-6` | `anthropic/claude-sonnet-4-6` |

IDs are used verbatim, including every component of model IDs containing `/`. The label follows the model in the current native rendering context.

OMP's renderer still handles model icons, thinking levels, compact/automatic thinking, fast/advisor badges, themes, and layout. Terminal-width truncation follows OMP's normal behavior.

## Installation (recommended)

```bash
omp plugin install github:hypn4/omp-provider-statusline
```

Restart OMP to load the plugin.

To update an existing installation:

```bash
omp plugin upgrade omp-provider-statusline
```

Restart OMP after upgrading. In OMP 18.12.3, reloading a session does not reload extension code.

## Configuration

Keep the native `model` segment enabled. Existing presets containing `model` work without changes. For a custom layout, include `model` in `statusLine.leftSegments` or `statusLine.rightSegments`.

The plugin does not need the `status` segment or a particular `showHookStatus` setting. Other extensions' status messages remain independent.

### Migrating from 0.1.x

Replace the `status` entry previously used for this plugin with `model`, preserving your other segments. Keep a separate `status` entry only if you want other extensions' messages in the statusline. Choose `showHookStatus` according to your footer preference.

## Compatibility

Tested with OMP 18.12.3. No build step or additional runtime dependencies.

The plugin hooks `api.pi.SEGMENTS.model` from OMP's injected SDK and delegates to the original `render` and `describe` methods. It changes only the label for that render, without modifying session/model data or polling. Hooks are released when the owning extension sessions shut down.

This uses OMP's exported segment registry, not a dedicated stable formatter API. Hosts without a compatible registry retain their native model display and show a compatibility warning.

## Development

```bash
bun install
bun test
omp plugin link .
```

Tests exercise the actual OMP 18.12.3 model renderer, including native decorations, complete IDs, model changes, shared hook ownership, and cleanup.

## Uninstall

```bash
omp plugin uninstall omp-provider-statusline
```

Restart OMP. The native `model` segment returns to its default label.

## License

[MIT](LICENSE)
