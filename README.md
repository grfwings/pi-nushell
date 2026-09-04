# pi-nushell

A [Pi](https://pi.dev) extension that adds a `nu` tool for executing [Nushell](https://www.nushell.sh/) commands.

The tool follows Pi's built-in `bash` tool behavior:

- runs in the current session working directory;
- streams combined standard output and standard error;
- supports cancellation and optional timeouts;
- reports nonzero exit codes as tool errors;
- limits output to the last 2,000 lines or 50 KB;
- saves complete output to a temporary file when truncation occurs;
- exposes `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` to the command.

Unlike `bash`, the `nu` tool accepts Nushell syntax and supports structured-data pipelines.

## Requirements

- Pi 0.84.4 or newer
- nushell

Set `PI_NU_PATH` to use a Nushell executable that is not on `PATH`:

## Install

Install this directory as a local Pi package:

```sh
pi install /path/to/pi-nushell
```

For development, load the extension directly:

```sh
pi -e ./index.ts
```

Pi discovers `index.ts` through the `pi.extensions` entry in `package.json`.

## Tool input

```json
{
  "command": "open package.json | get scripts",
  "timeout": 30
}
```

- `command` is required and must use Nushell syntax.
- `timeout` is optional and is measured in seconds. There is no default timeout.

Nushell's `-c` mode does not load the user's `config.nu`; this is standard Nushell behavior for command strings.

## Development

```sh
bun install
bun run check
bun run test
```

## License

MIT
