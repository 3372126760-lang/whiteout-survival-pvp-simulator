export interface ValidationRunToolInput {
  readonly randomSeed?: number;
  readonly maxRounds?: number;
}

interface ImperativeWebMcpTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly untrustedContentHint: boolean;
  };
  readonly execute: (input: unknown) => unknown | Promise<unknown>;
}

interface ImperativeModelContext {
  registerTool(
    tool: ImperativeWebMcpTool,
    options?: { readonly signal?: AbortSignal },
  ): void | Promise<void>;
}

interface WebMcpDocument extends Document {
  readonly modelContext?: ImperativeModelContext;
}

/**
 * Exposes the UI's primary Run Battle journey when the host browser supports
 * imperative WebMCP. Unsupported browsers simply retain the normal UI.
 */
export function registerValidationWebMcp(options: {
  readonly run: (input: ValidationRunToolInput) => unknown;
  readonly onRegistrationError: (error: unknown) => void;
}): () => void {
  const context = (document as WebMcpDocument).modelContext;
  if (context?.registerTool === undefined) return () => undefined;

  const lifecycle = new AbortController();
  try {
    void Promise.resolve(context.registerTool({
      name: "configure_and_run_pvp_validation",
      title: "Configure and run PVP validation",
      description:
        "Optionally set the visible validation seed/max rounds, run the current A/B configuration through the PVP engine, and update the visible BattleTrace results.",
      inputSchema: {
        type: "object",
        properties: {
          randomSeed: { type: "integer" },
          maxRounds: { type: "integer", minimum: 1, maximum: 1500 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(rawInput) {
        return options.run(validateRunInput(rawInput));
      },
    }, { signal: lifecycle.signal })).catch(options.onRegistrationError);
  } catch (error) {
    options.onRegistrationError(error);
  }
  return () => lifecycle.abort();
}

function validateRunInput(input: unknown): ValidationRunToolInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("WebMCP input must be an object.");
  }
  const values = input as Record<string, unknown>;
  const allowed = new Set(["randomSeed", "maxRounds"]);
  if (Object.keys(values).some((key) => !allowed.has(key))) {
    throw new TypeError("WebMCP input contains an unsupported property.");
  }
  const randomSeed = optionalSafeInteger(values.randomSeed, "randomSeed");
  const maxRounds = optionalSafeInteger(values.maxRounds, "maxRounds");
  if (maxRounds !== undefined && (maxRounds < 1 || maxRounds > 1500)) {
    throw new RangeError("maxRounds must be from 1 to 1500.");
  }
  return {
    ...(randomSeed === undefined ? {} : { randomSeed }),
    ...(maxRounds === undefined ? {} : { maxRounds }),
  };
}

function optionalSafeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer.`);
  }
  return value;
}
