import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import { redactValue, redactString } from "./redact";

/**
 * Application logger. Every field and message passes through the redactor, so phone numbers,
 * tokens and secrets cannot reach log output even if a caller passes them by mistake.
 */
function build() {
  const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "warn" : "info");
  const file = process.env.LOG_FILE;
  let dest: pino.DestinationStream | undefined;
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    dest = pino.destination({ dest: file, sync: true, append: true });
  }
  return pino(
    {
      level,
      base: { app: "pryingeyes" },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        log: (obj) => redactValue(obj) as Record<string, unknown>,
      },
      hooks: {
        logMethod(args, method) {
          const cleaned = args.map((a) => (typeof a === "string" ? redactString(a) : redactValue(a)));
          return method.apply(this, cleaned as Parameters<typeof method>);
        },
      },
    },
    dest,
  );
}

const g = globalThis as unknown as { __peLog?: pino.Logger };
export const log: pino.Logger = g.__peLog ?? (g.__peLog = build());
