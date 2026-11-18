# Image Guard for OpenChamber

An OpenChamber extension that ships an OpenCode plugin: it caps **image count** per model request for providers with a low per-request image limit.

Installing the extension is enough — OpenChamber adds the bundled plugin to the OpenCode config it manages, and removing the extension takes it out again. Nothing is written into your own `opencode.json`.

## The problem

Some provider/model pairs reject a request when it carries too many images. Mistral's `deepseek-v4-1-flash-1017` allows 20:

```
{"object":"error","message":"Total number of images exceeds the maximum allowed of 20.",
 "type":"invalid_request_invalid_args","code":"3051","raw_status_code":400}
```

OpenCode replays the entire session history on every turn. Screenshots from browser tools, `read` on PNGs, and attachments accumulate until the 21st image is reached — after which every request fails, including plain-text prompts. `/compact` cannot recover the session, because the compaction request carries the images too.

Related upstream issues: `anomalyco/opencode#47721`, `#63287`, `#64187`.

## What it does

Before each model request, the bundled plugin:

1. counts image parts across the assembled request — prompt attachments (`type: "media"`) and tool-result images (`type: "file"` with a `data:` URI, nested in `result.value`);
2. if there are more than `MAX_IMAGES`, keeps the **newest** `MAX_IMAGES` and replaces older ones with a short text placeholder naming the file;
3. leaves text, tool calls and tool results untouched.

Only the outgoing request is changed. Stored history is not modified, so session search, memory, and summaries still see the original content. This also makes an already-poisoned session usable again on its next prompt, and unlike session compaction it discards no text.

## Install

In OpenChamber: **Settings → Extensions → Add**, paste this repository's Git URL, approve the capability dialog (it lists *Add a plugin to OpenCode*), and enable **Image Guard**.

The panel on the rail explains the current settings. The extension has no service, no network access and no filesystem access.

## Configuration

The plugin reads two environment variables on the **OpenCode server** at load time:

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENCODE_MAX_IMAGES` | `15` | Maximum image parts per request. Keep it below the provider's limit. |
| `IMAGE_GUARD_MODELS` | `mistral/deepseek-v4-1-flash-1017` | Comma-separated `provider/model` list the guard applies to. |

## Log

Each request that drops images appends one line to:

```
~/.local/share/opencode/log/image-guard.log
```

```
2026-11-18T06:44:56.925Z session=ses_… model=mistral/deepseek-v4-1-flash-1017 images=21 dropped=6 kept=15
```

## Verified

OpenCode `2.3.0`, model `mistral/deepseek-v4-1-flash-1017`:

| Scenario | Images in request | Dropped | Result |
| --- | --- | --- | --- |
| 21 file attachments | 21 | 6 | request accepted (without the guard: HTTP 400 / code 3051) |
| 16 PNGs read via the `read` tool | 16 | 1 | request accepted |
| ≤ 15 images | ≤ 15 | 0 | untouched |

## Compatibility

- OpenChamber extension manifest `apiVersion: 1`; ships `contributes.opencodePlugin`.
- The plugin uses the OpenCode 2.x plugin API (`session.hook("context")`, `session.hook("compaction")`). The V1 `server` export is a no-op.
- Coexists with context-management plugins (e.g. `@cortexkit/opencode-magic-context`): those operate on persisted history, this only rewrites the outgoing request.
- Hook order is host-defined. If another plugin rebuilds image parts after the context stage, the cap can be undone; the log line is the canary.

## Standalone version

The same plugin is also published as a plain OpenCode plugin for machines without OpenChamber: <https://github.com/aaxyat/opencode-image-guard>.

## License

MIT — see [LICENSE](LICENSE).
