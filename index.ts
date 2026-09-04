import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";
import type {
	BashOperations,
	BashSpawnHook,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createLocalBashOperations,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

const nuToolSchema = Type.Object({
	command: Type.String({ description: "Nushell command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

export type NuToolInput = Static<typeof nuToolSchema>;

export interface NuToolOptions {
	/** Override command execution, for example to run Nushell on a remote host. */
	operations?: BashOperations;
	/** Explicit Nushell executable. Defaults to PI_NU_PATH, then `nu` on PATH. */
	nuPath?: string;
	/** Expose current Pi session metadata as PI_* environment variables. Defaults to true. */
	exposeSessionEnvironment?: boolean;
	/** Adjust the command, cwd, or environment immediately before execution. */
	spawnHook?: BashSpawnHook;
}

function isExecutableFile(path: string): boolean {
	try {
		if (!statSync(path).isFile()) return false;
		if (process.platform !== "win32") accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
	const exact = env[name];
	if (exact !== undefined || process.platform !== "win32") return exact;
	const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
	return key === undefined ? undefined : env[key];
}

function executableNames(name: string, env: NodeJS.ProcessEnv): string[] {
	if (process.platform !== "win32" || /\.[^./\\]+$/.test(name)) return [name];
	const extensions = (environmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
	return [name, ...extensions.map((extension) => `${name}${extension.toLowerCase()}`)];
}

/** Resolve the Nushell executable without invoking another shell. */
export function resolveNuExecutable(
	requestedPath?: string,
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): string {
	const executableName = requestedPath ?? environmentValue(env, "PI_NU_PATH") ?? "nu";
	const hasDirectory = isAbsolute(executableName) || executableName.includes("/") || executableName.includes("\\");
	if (hasDirectory) {
		const candidate = isAbsolute(executableName) ? executableName : resolve(cwd, executableName);
		if (isExecutableFile(candidate)) return candidate;
		throw new Error(`Nushell executable not found or not executable: ${candidate}`);
	}

	for (const directory of (environmentValue(env, "PATH") ?? "").split(delimiter)) {
		for (const name of executableNames(executableName, env)) {
			const candidate = resolve(cwd, directory || ".", name);
			if (isExecutableFile(candidate)) return candidate;
		}
	}

	const suffix = executableName === "nu" ? " Install Nushell or set PI_NU_PATH." : "";
	throw new Error(`Nushell executable not found on PATH: ${executableName}.${suffix}`);
}

/** Create operations that use Pi's process, streaming, timeout, and cancellation backend with `nu -c`. */
export function createLocalNuOperations(nuPath?: string): BashOperations {
	return {
		async exec(command, cwd, options) {
			const executable = resolveNuExecutable(nuPath, options.env, cwd);
			const operations = createLocalBashOperations({ shellPath: executable });
			return operations.exec(command, cwd, options);
		},
	};
}

/** Create the `nu` tool definition for registration in Pi. */
export function createNuToolDefinition(cwd: string, options: NuToolOptions = {}) {
	const definition = createBashToolDefinition(cwd, {
		operations: options.operations ?? createLocalNuOperations(options.nuPath),
		exposeSessionEnvironment: options.exposeSessionEnvironment,
		spawnHook: options.spawnHook,
	});

	const renderCall: NonNullable<typeof definition.renderCall> = (args, theme, context) => {
		const state = context.state;
		if (context.executionStarted && state.startedAt === undefined) {
			state.startedAt = Date.now();
			state.endedAt = undefined;
		}

		const command = typeof args?.command === "string" ? args.command : "...";
		const timeout = typeof args?.timeout === "number" ? theme.fg("muted", ` (timeout ${args.timeout}s)`) : "";
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(theme.fg("toolTitle", theme.bold(`nu> ${command}`)) + timeout);
		return text;
	};

	const promptGuidelines = ["The nu tool accepts Nushell syntax, not Bash syntax."];
	if (options.exposeSessionEnvironment !== false) {
		promptGuidelines.push(
			"You can inspect Pi session metadata in the nu tool through $env.PI_SESSION_ID and the other PI_* environment variables.",
		);
	}

	return {
		...definition,
		name: "nu",
		label: "nu",
		description: `Execute a Nushell command in the current working directory. Returns combined stdout and stderr. Output is truncated to the last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temporary file. Optionally provide a timeout in seconds.`,
		promptSnippet: "Execute Nushell commands and structured-data pipelines",
		promptGuidelines,
		parameters: nuToolSchema,
		renderCall,
	};
}

export default function nushellExtension(pi: ExtensionAPI): void {
	pi.registerTool(createNuToolDefinition(process.cwd()));
}
