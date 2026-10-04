# pi-nushell

A pi extension for [nushell](https://www.nushell.sh/) users.

Pi-nushell does two things:
- adds a nu tool for executing nushell commands, and disables the bash tool.
- replaces the `!command` interpreter with nushell.

The `nu` tool matches pi's built-in `bash` tool behavior:

- runs in the current session working directory.
- streams combined standard output and standard error.
- supports cancellation and optional timeouts.
- reports nonzero exit codes as tool errors.
- limits output to the last 2,000 lines or 50 KB.
- saves complete output to a temporary file when truncation occurs.
- exposes `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` to the command.
- uses command-string mode, meaning it does not load configuration files like `config.nu`.

Pi prepends `shellCommandPrefix` to user commands before execution, so any configured prefix must use Nushell syntax (or be unset).

## Requirements

- nushell

## Install

```sh
pi install npm:pi-nushell
```

For development, load the extension directly:

```sh
pi -e ./index.ts
```

