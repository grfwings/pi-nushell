# pi-nushell

A pi extension that adds a `nu` tool for executing [nushell](https://www.nushell.sh/) commands.

The tool follows pi's built-in `bash` tool behavior:

- runs in the current session working directory;
- streams combined standard output and standard error;
- supports cancellation and optional timeouts;
- reports nonzero exit codes as tool errors;
- limits output to the last 2,000 lines or 50 KB;
- saves complete output to a temporary file when truncation occurs;
- exposes `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` to the command.

## Requirements

- nushell

Set `PI_NU_PATH` to use a nushell executable that is not on `PATH`:

## Install

```sh
pi install npm:pi-nushell
```

For development, load the extension directly:

```sh
pi -e ./index.ts
```

## Tool input

```json
{
  "command": "open package.json | get scripts",
  "timeout": 30
}
```

- `command` is required and must use nushell syntax.
- `timeout` is optional and is measured in seconds. There is no default timeout.

This extension uses nushell's command-string mode, meaning it does not load configuration files like `config.nu`.
