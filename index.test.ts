import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { BashOperations, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "bun:test";
import nushellExtension, {
	createNuToolDefinition,
	resolveNuExecutable,
} from "./index.js";

const temporaryDirectories: string[] = [];
const temporaryFiles: string[] = [];

function temporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-nushell-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((item) => item.type === "text")
		.map((item) => item.text ?? "")
		.join("\n");
}

afterEach(() => {
	for (const path of temporaryFiles.splice(0)) rmSync(path, { force: true });
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("resolveNuExecutable", () => {
	it("finds nu on PATH", () => {
		const directory = temporaryDirectory();
		const filename = process.platform === "win32" ? "nu.exe" : "nu";
		const executable = join(directory, filename);
		writeFileSync(executable, "");
		if (process.platform !== "win32") chmodSync(executable, 0o755);

		expect(resolveNuExecutable("nu", { PATH: directory, PATHEXT: ".EXE" }, directory)).toBe(executable);
	});

	it("accepts an explicit executable path", () => {
		const directory = temporaryDirectory();
		const filename = process.platform === "win32" ? "custom-nu.exe" : "custom-nu";
		const executable = join(directory, filename);
		writeFileSync(executable, "");
		if (process.platform !== "win32") chmodSync(executable, 0o755);

		expect(resolveNuExecutable(executable, { PATH: "" }, directory)).toBe(executable);
	});

	it("reports how to install a missing executable", () => {
		const directory = temporaryDirectory();
		expect(() => resolveNuExecutable("nu", { PATH: directory }, directory)).toThrow("Install Nushell");
	});
});

describe("createNuToolDefinition", () => {
	it("defines the public contract for the nu tool", () => {
		const tool = createNuToolDefinition(process.cwd(), {
			operations: { exec: async () => ({ exitCode: 0 }) },
		});

		expect(tool.name).toBe("nu");
		expect(tool.label).toBe("nu");
		expect(tool.description).toContain("Nushell");
		expect(tool.promptSnippet).toContain("structured-data pipelines");
		expect(tool.parameters.required).toContain("command");
		expect(tool.parameters.properties.command).toMatchObject({ type: "string" });
		expect(tool.parameters.required).not.toContain("timeout");
		expect(tool.parameters.properties.timeout).toMatchObject({ type: "number" });
	});

	it("omits session-environment guidance when exposure is disabled", () => {
		const tool = createNuToolDefinition(process.cwd(), {
			exposeSessionEnvironment: false,
			operations: { exec: async () => ({ exitCode: 0 }) },
		});

		const guidance = tool.promptGuidelines.join(" ");
		expect(guidance).toContain("Nushell syntax");
		expect(guidance).not.toContain("PI_");
	});

	it("preserves Bash tool streaming, cwd, timeout, and result behavior", async () => {
		const cwd = temporaryDirectory();
		let received:
			| { command: string; cwd: string; timeout: number | undefined; hasSessionEnvironment: boolean }
			| undefined;
		const operations: BashOperations = {
			async exec(command, operationCwd, { onData, timeout, env }) {
				received = {
					command,
					cwd: operationCwd,
					timeout,
					hasSessionEnvironment: env !== undefined,
				};
				onData(Buffer.from("structured output\n"));
				return { exitCode: 0 };
			},
		};
		const updates: string[] = [];
		const tool = createNuToolDefinition(cwd, { operations });
		const result = await tool.execute(
			"nu-test",
			{ command: "[1 2 3] | math sum", timeout: 2 },
			undefined,
			(update) => updates.push(textOf(update)),
			undefined as never,
		);

		expect(received).toEqual({
			command: "[1 2 3] | math sum",
			cwd,
			timeout: 2,
			hasSessionEnvironment: true,
		});
		expect(textOf(result)).toBe("structured output\n");
		expect(updates).toContain("structured output\n");
	});

	it("exposes current Pi session metadata to Nushell", async () => {
		let receivedEnvironment: NodeJS.ProcessEnv | undefined;
		const operations: BashOperations = {
			async exec(_command, _cwd, { env }) {
				receivedEnvironment = env;
				return { exitCode: 0 };
			},
		};
		const cwd = temporaryDirectory();
		const context = {
			cwd,
			model: { provider: "test-provider", id: "test-model" },
			thinkingLevel: "high",
			sessionManager: {
				getSessionId: () => "session-123",
				getSessionFile: () => "/tmp/session.jsonl",
			},
		} as unknown as ExtensionContext;
		const tool = createNuToolDefinition(cwd, { operations });

		await tool.execute("nu-env", { command: "$env.PI_SESSION_ID" }, undefined, undefined, context);

		expect(receivedEnvironment).toMatchObject({
			PI_SESSION_ID: "session-123",
			PI_SESSION_FILE: "/tmp/session.jsonl",
			PI_PROVIDER: "test-provider",
			PI_MODEL: "test-model",
			PI_REASONING_LEVEL: "high",
		});
	});

	it("removes inherited session metadata when exposure is disabled", async () => {
		let receivedEnvironment: NodeJS.ProcessEnv | undefined;
		const operations: BashOperations = {
			async exec(_command, _cwd, { env }) {
				receivedEnvironment = env;
				return { exitCode: 0 };
			},
		};
		const context = {
			cwd: process.cwd(),
			model: { provider: "test-provider", id: "test-model" },
			thinkingLevel: "high",
			sessionManager: {
				getSessionId: () => "session-123",
				getSessionFile: () => "/tmp/session.jsonl",
			},
		} as unknown as ExtensionContext;
		const tool = createNuToolDefinition(process.cwd(), {
			operations,
			exposeSessionEnvironment: false,
		});

		await tool.execute("nu-no-env", { command: "version" }, undefined, undefined, context);

		expect(receivedEnvironment?.PI_SESSION_ID).toBeUndefined();
		expect(receivedEnvironment?.PI_SESSION_FILE).toBeUndefined();
		expect(receivedEnvironment?.PI_PROVIDER).toBeUndefined();
		expect(receivedEnvironment?.PI_MODEL).toBeUndefined();
		expect(receivedEnvironment?.PI_REASONING_LEVEL).toBeUndefined();
	});

	it("truncates large output and persists the complete output", async () => {
		const completeOutput = Array.from({ length: 2_100 }, (_, index) => `line-${index + 1}`).join("\n");
		const operations: BashOperations = {
			async exec(_command, _cwd, { onData }) {
				onData(Buffer.from(completeOutput));
				return { exitCode: 0 };
			},
		};
		const tool = createNuToolDefinition(process.cwd(), { operations });
		const result = await tool.execute("nu-large", { command: "large output" }, undefined, undefined, undefined as never);
		const fullOutputPath = result.details?.fullOutputPath;

		expect(result.details?.truncation?.truncated).toBe(true);
		expect(result.details?.truncation?.outputLines).toBe(2_000);
		expect(textOf(result)).toContain("line-2100");
		expect(fullOutputPath).toBeTypeOf("string");
		temporaryFiles.push(fullOutputPath!);
		expect(readFileSync(fullOutputPath!, "utf8")).toBe(completeOutput);
	});

	it("turns nonzero exits into tool errors", async () => {
		const operations: BashOperations = {
			async exec(_command, _cwd, { onData }) {
				onData(Buffer.from("failure details"));
				return { exitCode: 7 };
			},
		};
		const tool = createNuToolDefinition(process.cwd(), { operations });

		await expect(
			tool.execute("nu-failure", { command: "exit 7" }, undefined, undefined, undefined as never),
		).rejects.toThrow(/failure details[\s\S]*Command exited with code 7/);
	});
});

describe("extension registration", () => {
	it("registers the nu tool", () => {
		let registeredName: string | undefined;
		const pi = {
			registerTool(tool: { name: string }) {
				registeredName = tool.name;
			},
		} as unknown as ExtensionAPI;

		nushellExtension(pi);
		expect(registeredName).toBe("nu");
	});
});

let installedNu: string | undefined;
try {
	installedNu = resolveNuExecutable();
} catch {
	installedNu = undefined;
}

describe.skipIf(!installedNu)("Nushell integration", () => {
	it("executes Nushell structured-data pipelines", async () => {
		const tool = createNuToolDefinition(process.cwd(), { nuPath: installedNu });
		const result = await tool.execute(
			"nu-integration",
			{
				command: "[{name: Ada, score: 3}, {name: Lin, score: 5}] | where score > 3 | get name.0",
			},
			undefined,
			undefined,
			undefined as never,
		);

		expect(textOf(result).trim()).toBe("Lin");
	});

	it("captures both standard output and standard error", async () => {
		const tool = createNuToolDefinition(process.cwd(), { nuPath: installedNu });
		const result = await tool.execute(
			"nu-output",
			{ command: "print out; print --stderr err" },
			undefined,
			undefined,
			undefined as never,
		);

		expect(textOf(result)).toContain("out");
		expect(textOf(result)).toContain("err");
	});

	it("executes in the tool working directory", async () => {
		const cwd = temporaryDirectory();
		const tool = createNuToolDefinition(cwd, { nuPath: installedNu });
		const result = await tool.execute(
			"nu-cwd",
			{ command: "pwd | path basename" },
			undefined,
			undefined,
			undefined as never,
		);

		expect(textOf(result).trim()).toBe(basename(cwd));
	});

	it("honors cancellation", async () => {
		const controller = new AbortController();
		const tool = createNuToolDefinition(process.cwd(), { nuPath: installedNu });
		const execution = tool.execute(
			"nu-cancel",
			{ command: "sleep 2sec" },
			controller.signal,
			undefined,
			undefined as never,
		);
		setTimeout(() => controller.abort(), 50);

		await expect(execution).rejects.toThrow("Command aborted");
	});

	it("enforces timeouts", async () => {
		const tool = createNuToolDefinition(process.cwd(), { nuPath: installedNu });
		await expect(
			tool.execute(
				"nu-timeout",
				{ command: "sleep 2sec", timeout: 0.05 },
				undefined,
				undefined,
				undefined as never,
			),
		).rejects.toThrow("Command timed out after 0.05 seconds");
	});
});
