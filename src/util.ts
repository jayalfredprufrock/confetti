import { CONFETTI, DATA, DEFAULT, ENV, TYPE } from "./symbols";
import type {
  ConfigEntry,
  Confetti,
  ConfigValPerEnv,
  Fetcher,
  FetcherContext,
  Obj,
  TypeTag,
} from "./types";

export const isObj = (val: unknown): val is Obj => {
  return val !== null && typeof val === "object" && !Array.isArray(val);
};

export const isConfigValPerEnv = (val: unknown): val is ConfigValPerEnv => {
  return isObj(val) && (DEFAULT in val || DATA in val || ENV in val || TYPE in val);
};

export const isNestedConfig = (val: unknown): val is Obj => {
  return isObj(val) && !isConfigValPerEnv(val);
};

export const isConfetti = (val: unknown): val is Confetti<any> => {
  return typeof val === "function" && Object.hasOwn(val, CONFETTI);
};

export const isThenable = (v: unknown): v is PromiseLike<unknown> => {
  return (
    v !== null &&
    typeof v === "object" &&
    "then" in v &&
    typeof (v as { then: unknown }).then === "function"
  );
};

export const getAtPath = (config: Obj, path: string): unknown => {
  if (!path) return config;
  const segments = path.split(".");
  let node: unknown = config;
  for (const segment of segments) {
    if (!isNestedConfig(node)) {
      throw new Error(`Invalid config path '${path}'.`);
    }
    node = node[segment];
    if (node === undefined) {
      throw new Error(`Invalid config path '${path}'.`);
    }
  }
  return node;
};

const matchesType = (val: unknown, type: TypeTag): boolean => {
  if (type === "string") return typeof val === "string";
  if (type === "number") return typeof val === "number" && !Number.isNaN(val);
  if (type === "boolean") return typeof val === "boolean";
  if (!Array.isArray(val)) return false;
  const elem = type.slice(0, -2);
  return val.every((x) => typeof x === elem);
};

export const coerceFromString = (raw: string, type: TypeTag, path: string): unknown => {
  if (type === "string") return raw;
  if (type === "number") {
    if (raw === "") throw new Error(`Cannot coerce empty string to number at '${path}'.`);
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`Cannot coerce '${raw}' to number at '${path}'.`);
    return n;
  }
  if (type === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`Cannot coerce '${raw}' to boolean at '${path}' (expected 'true' or 'false').`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Cannot coerce '${raw}' to ${type} at '${path}' (invalid JSON).`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Cannot coerce '${raw}' to ${type} at '${path}' (not an array).`);
  }
  const elem = type.slice(0, -2);
  if (!parsed.every((x) => typeof x === elem)) {
    throw new Error(`Cannot coerce '${raw}' to ${type} at '${path}' (element type mismatch).`);
  }
  return parsed;
};

const coerceFetched = (fetched: unknown, type: TypeTag | undefined, path: string): unknown => {
  if (type === undefined) {
    if (typeof fetched !== "string") {
      throw new Error(
        `Fetcher for '${path}' must return a string (add [TYPE] to use non-string values).`,
      );
    }
    return fetched;
  }
  if (typeof fetched === "string") return coerceFromString(fetched, type, path);
  if (matchesType(fetched, type)) return fetched;
  throw new Error(`Fetcher for '${path}' returned value that doesn't match [TYPE] '${type}'.`);
};

export const buildEntry = (node: unknown, path: string, env: string): ConfigEntry => {
  if (!isConfigValPerEnv(node)) {
    return { path, value: node };
  }

  const envVar = node[ENV];
  const data = node[DATA];
  const defaultVal = node[DEFAULT];
  const typeTag = node[TYPE];
  const entry: ConfigEntry = { path };

  if (envVar && process.env[envVar] !== undefined) {
    const raw = process.env[envVar]!;
    entry.value = typeTag ? coerceFromString(raw, typeTag, path) : raw;
  } else if (node[env] !== undefined) {
    entry.value = node[env];
  }

  if (defaultVal !== undefined) entry.default = defaultVal;
  if (envVar) entry.envVar = envVar;
  if (data !== undefined) entry.data = data;
  if (typeTag !== undefined) entry.type = typeTag;

  return entry;
};

export function* entriesIter(
  config: Obj,
  env: string,
  pathPrefix = "",
): IterableIterator<[string, ConfigEntry]> {
  for (const [key, value] of Object.entries(config)) {
    const path = pathPrefix + key;
    if (isNestedConfig(value)) {
      yield* entriesIter(value, env, `${path}.`);
    } else {
      yield [path, buildEntry(value, path, env)];
    }
  }
}

export const invokeSync = (source: unknown, path: string, env: string): unknown => {
  if (typeof source !== "function") return source;
  const result = (source as (env: string) => unknown)(env);
  if (isThenable(result)) {
    throw new Error(`Config at '${path}' requires async resolution (use resolve).`);
  }
  return result;
};

export const invokeAsync = async (source: unknown, env: string): Promise<unknown> => {
  return typeof source === "function" ? await (source as (env: string) => unknown)(env) : source;
};

export const resolveEntrySync = (entry: ConfigEntry, env: string): unknown => {
  if ("value" in entry) return invokeSync(entry.value, entry.path, env);
  if ("default" in entry) return invokeSync(entry.default, entry.path, env);
  throw new Error(`Config at '${entry.path}' requires async resolution (use resolve).`);
};

export const resolveEntryAsync = async (
  entry: ConfigEntry,
  env: string,
  fetcher: Fetcher,
): Promise<unknown> => {
  if ("value" in entry) return invokeAsync(entry.value, env);

  if (entry.envVar !== undefined || entry.data !== undefined) {
    const ctx: FetcherContext = {
      env,
      default: entry.default,
      envVar: entry.envVar,
      data: entry.data,
      type: entry.type,
    };
    const fetched = await fetcher(ctx);
    if (fetched !== undefined) return coerceFetched(fetched, entry.type, entry.path);
  }

  if ("default" in entry) return invokeAsync(entry.default, env);
  throw new Error(`Unable to resolve config value at '${entry.path}'.`);
};

export const resolveSubtreeSync = (node: Obj, prefix: string, env: string): Obj => {
  const result: Obj = {};
  for (const [key, child] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    result[key] = isNestedConfig(child)
      ? resolveSubtreeSync(child, path, env)
      : resolveEntrySync(buildEntry(child, path, env), env);
  }
  return result;
};

export const resolveSubtreeAsync = async (
  node: Obj,
  prefix: string,
  env: string,
  fetcher: Fetcher,
): Promise<Obj> => {
  const keys = Object.keys(node);
  const values = await Promise.all(
    keys.map((key) => {
      const child = node[key];
      const path = prefix ? `${prefix}.${key}` : key;
      return isNestedConfig(child)
        ? resolveSubtreeAsync(child, path, env, fetcher)
        : resolveEntryAsync(buildEntry(child, path, env), env, fetcher);
    }),
  );
  const result: Obj = {};
  keys.forEach((key, i) => {
    result[key] = values[i];
  });
  return result;
};
