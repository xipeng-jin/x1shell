import { mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { redactText, redactUnknown, redactValue } from "./redaction.js";
import { sanitizeText } from "../terminal/safeTextStream.js";

export interface Logger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
  close(): Promise<void>;
}

export function createLogger(options: { logFile: string; verbose?: boolean }): Logger {
  let handlePromise: Promise<FileHandle> | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  const getHandle = async () => {
    handlePromise ??= mkdir(dirname(options.logFile), { recursive: true }).then(() =>
      open(options.logFile, "a"),
    );
    return handlePromise;
  };

  const reportWriteError = (error: unknown) => {
    if (options.verbose) {
      process.stderr.write(`${safeOutputUnknown(error)}\n`);
    }
  };

  const write = (level: "info" | "warn" | "error", message: string, details?: unknown) => {
    const entry = safeJsonLine({
      time: new Date().toISOString(),
      level,
      message: safeOutputText(message),
      ...(details === undefined ? {} : { details: safeOutputValue(details) }),
    });

    writeChain = writeChain
      .then(async () => {
        const handle = await getHandle();
        await handle.appendFile(`${entry}\n`, "utf8");
      })
      .catch(reportWriteError);

    if (options.verbose || level === "error") {
      const line =
        details === undefined
          ? safeOutputText(message)
          : `${safeOutputText(message)} ${safeOutputUnknown(details)}`;
      const target = level === "error" ? process.stderr : process.stdout;
      target.write(`${line}\n`);
    }
  };

  return {
    info: (message, details) => write("info", message, details),
    warn: (message, details) => write("warn", message, details),
    error: (message, details) => write("error", message, details),
    close: async () => {
      await writeChain;
      const handle = await handlePromise?.catch(() => null);
      await handle?.close();
    },
  };
}

function safeJsonLine(value: unknown): string {
  try {
    return JSON.stringify(value, jsonSafeReplacer) ?? "null";
  } catch (error) {
    return JSON.stringify({
      time: new Date().toISOString(),
      level: "error",
      message: "failed to serialize log entry",
      details: safeOutputText(String(error)),
    });
  }
}

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function safeOutputText(value: string): string {
  return sanitizeText(redactText(value));
}

export function safeOutputUnknown(value: unknown): string {
  return sanitizeText(redactUnknown(value));
}

export function safeOutputValue<T>(value: T): T {
  return sanitizeStructuredValue(redactValue(value), new WeakSet()) as T;
}

function sanitizeStructuredValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructuredValue(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = sanitizeStructuredValue(entry, seen);
  }
  return output;
}
