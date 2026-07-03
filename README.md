<p align="center">
  <img src="./confetti-logo.png" alt="confetti" width="240" />
</p>

<h1 align="center">confetti</h1>

<p align="center">
  Type-safe, multi-environment configuration where <strong>your config file is the source of truth</strong>.
</p>

---

## Why

- **Ultra type-safe.** Paths and return values are fully inferred — `get('nested.prop')` gives you autocomplete and the correct type, no casting.
- **Environments, side-by-side.** Staging and prod values live next to each other in the config, not scattered across files.
- **Source of truth**. Making something configurable only requires touching one file. Start with a default across environments and easily override per environment later.
- **Consumers resolve special values.** `confetti` tracks _what_ a value is (an env var, a remote secret, a default) and hands that metadata to the consumer — it doesn't dial AWS for you.

## Install

```sh
npm add @jayalfredprufrock/confetti
```

## Basic usage

```ts
import { makeConfig, DEFAULT, ENV, DATA, TYPE } from "@jayalfredprufrock/confetti";

const config = makeConfig({
  appName: "my-app",
  port: 3000,

  feature: {
    enabled: true,
    limit: 50,
  },

  apiUrl: {
    [DEFAULT]: "http://localhost:3000",
    staging: "https://api.staging.example.com",
    prod: "https://api.example.com",
  },

  dbPassword: {
    [ENV]: "DB_PASSWORD",
    [DATA]: "db/password",
    [DEFAULT]: "",
  },

  maxConnections: {
    [TYPE]: "number",
    [ENV]: "MAX_CONNECTIONS",
    [DEFAULT]: 10,
  },
});

// Pick an environment, then read values.
const cfg = config("prod");

// paths and types fully inferred
cfg.get("appName"); // => 'my-app'
cfg.get("apiUrl"); // => 'https://api.example.com'
cfg.get("port"); // => 3000  (typed as number)
```

### Factory/Function pattern

Use the factory form when it's more convenient to produce multi-environment default values based on a naming convention:

```ts
const config = makeConfig((env: string) => ({
  serviceName: `my-app-${env}`,
  dbPassword: {
    [ENV]: "DB_PASSWORD",
    [DATA]: `${env}/password`,
    [DEFAULT]: "",
  },
}));
```

> **Type errors land on the whole factory, not the offending member.** Because the config type is inferred from the function's return value, TypeScript validates it as a single return-type check and anchors any error to the `(env) => …` function rather than to the specific property — so a bad `[DEFAULT]` shows a wall of text at the call site instead of a squiggle on the value. This is a TypeScript limitation, not something the signature can work around. **When you only need `env` to compute a value or two, prefer an individual value function (below)** — errors there point at the value itself.

#### Individual value functions

Any leaf can be a function of `env`. This keeps the surrounding config statically typed (so type errors stay local) and doubles as an escape hatch for storing an object as a single leaf value:

```ts
const config = makeConfig({
  serviceName: (env) => `my-app-${env}`,
  clientOptions: (env) => ({ enabled: true, region: env }),
});
```

**Caveats — a value function is an opaque leaf.** It's simply called with `env`; it does not participate in the per-env machinery. Specifically:

- **No `[TYPE]`, `[ENV]`/`[DATA]`, per-env precedence, or coercion.** A function is not a per-env block. If you need an env-var override, a fetched secret, or `[TYPE]` coercion, use the object form (`{ [ENV]: … }`) — a function can't express those.
- **Invisible to `entries()`.** For a function leaf, `entry.value` is _the function itself_ (not its result), and `envVar`/`data`/`type` are all absent. Metadata-driven tooling (required-env-var lists, IaC secret synthesis, readiness checks) can't see inside — so if you read `process.env` _inside_ a function, that dependency won't show up. Use the object form for anything such tooling needs to discover.
- **Object returns are single leaves, not subtrees.** `clientOptions` above resolves as one value; there are no `clientOptions.enabled` paths and no per-key typing.
- **Async functions can't be read with `get()`.** A function returning a `Promise` throws `requires async resolution` under `get()`; read it with `resolve()` instead.
- **Re-invoked on every read, never memoized.** Each `get()` / `resolve()` calls the function again. Keep them pure and cheap; don't rely on side effects firing once.

The factory form remains the right tool when you genuinely need `env` to shape _many_ values at once; individual value functions are the better default for one-off env-dependent leaves.

### Sync reads with `get`

`get(path)` is synchronous. Per-env values are selected by precedence:

1. explicit value (no multi-env object used)
2. `process.env[ENV]` if set (coerced per `[TYPE]` — see below)
3. the explicit per-env value (`cfg.get('apiUrl')` in `prod` returns the `prod` value)
4. `[DEFAULT]`, if present
5. otherwise, throw

```ts
cfg.get("apiUrl"); // 'https://api.example.com'
cfg.get("feature.enabled"); // true  (typed as boolean)

// Entire subtrees are fine too — everything resolves synchronously.
cfg.get("feature"); // { enabled: true, limit: 50 }

// Omit the path to get the entire resolved config.
cfg.get(); // { appName, port, feature: {...}, apiUrl, ... }
```

_If a leaf cannot be resolved syncronously, `get` throws. See `resolve` below for handling async configuration._

### Declaring leaf types with `[TYPE]`

External values (env vars, fetched secrets) are strings by nature but your config likely wants them typed. Use `[TYPE]` to declare the runtime shape and drive both TypeScript inference and automatic coercion.

```ts
const config = makeConfig({
  port: { [TYPE]: "number", [ENV]: "PORT", [DEFAULT]: 3000 },
  featureFlag: { [TYPE]: "boolean", [DATA]: "flags/checkout-v2" },
  allowedOrigins: { [TYPE]: "string[]", [ENV]: "ALLOWED_ORIGINS", [DEFAULT]: [] },
});

const cfg = config("prod");
cfg.get("port"); // typed as number — env var "8080" coerced to 8080
```

Supported tags: `"string" | "number" | "boolean" | "string[]" | "number[]" | "boolean[]"`, or a tuple of literals for a constrained union (see [below](#literal-unions-with-a-tuple-type)).

**Coercion rules (env vars and string fetcher returns):**

| Tag       | Expected raw                                        |
| --------- | --------------------------------------------------- |
| `string`  | as-is                                               |
| `number`  | `Number(raw)`; empty or `NaN` throws                |
| `boolean` | exactly `"true"` or `"false"`; anything else throws |
| `T[]`     | `JSON.parse` + array check + element type check     |

`[TYPE]` also constrains `[DEFAULT]` and per-env values at compile time — `{ [TYPE]: "number", [DEFAULT]: "nope" }` is a type error.

**When `[ENV]` or `[DATA]` are present without `[TYPE]`:** values are required to be strings (both `[DEFAULT]` and per-env overrides). The fetcher must also return a string. If you need a non-string here, add `[TYPE]`.

#### Literal unions with a tuple `[TYPE]`

Pass a tuple of allowed values instead of a tag string to type a leaf as a literal union _and_ validate external values against the set at runtime. This is the sound way to get a literal-union type out of an env var or fetched secret — the allowed values exist at runtime, so an out-of-set value throws rather than being silently trusted.

```ts
const config = makeConfig({
  logLevel: { [TYPE]: ["debug", "info", "warn", "error"], [ENV]: "LOG_LEVEL", [DEFAULT]: "info" },
  port: { [TYPE]: [80, 443, 8080], [DEFAULT]: 80 },
});

const cfg = config("prod");
cfg.get("logLevel"); // typed "debug" | "info" | "warn" | "error"
cfg.get("port"); // typed 80 | 443 | 8080
```

- **Inference:** the leaf resolves to the union of the tuple members, not the widened base type. No `as const` needed — the tuple is captured for you.
- **Constraint:** `[DEFAULT]` and per-env values must be members — `{ [TYPE]: ["debug", "info"], [DEFAULT]: "nope" }` is a type error.
- **Coercion (env vars / string fetcher returns):** each member is tried in declaration order — string members match the raw value directly, number members via `Number(raw)`, boolean members via `"true"`/`"false"`. The first match wins; a raw value matching no member throws.
- **Mixed sets are allowed** — `["auto", 0, 1, 3]` resolves to `"auto" | 0 | 1 | 3`, and `process.env` values coerce to the right member (`"auto"` → `"auto"`, `"3"` → `3`).

> **Ambiguity:** when a raw string could satisfy two members — e.g. `[1, "1"]` given `"1"`, or `["true", true]` given `"true"` — declaration order decides which one wins. Order such sets intentionally, or avoid the overlap.

### Async reads with `resolve`

`resolve(path, fetcher)` hands off to your code whenever a leaf can't be satisfied synchronously. You decide how to resolve it — read AWS Secrets Manager, call Vault, hit Parameter Store, whatever.

```ts
const password = await cfg.resolve("dbPassword", async (ctx) => {
  // ctx = { env: 'prod', envVar: 'DB_PASSWORD', data: 'prod/db/password', default: '' }
  const secret = await secretsClient.getSecretValue({ SecretId: ctx.data });
  return secret.SecretString;
});

// Omit the path to resolve the entire config — fetcher is invoked per leaf that needs it.
const fullConfig = await cfg.resolve(async (ctx) => {
  /* ... */
});
```

Rules:

- Explicit values and env overrides still win — the fetcher is only called when there's no sync value.
- Return `undefined` from the fetcher to fall back to `[DEFAULT]`.
- If `[TYPE]` is declared, a string return is coerced; a non-string must match `[TYPE]` exactly or it throws.
- Resolving a subtree calls the fetcher once per leaf that needs it; static leaves pass through untouched.

### Walking the config with `entries`

`entries()` returns a lazy iterator that yields `[path, entry]` for every leaf. Use it to drive downstream tooling — synthesize IaC secret resources, check for unset values in CI, etc.

```ts
for (const [path, entry] of cfg.entries()) {
  if (entry.envVar) {
    console.log(`${path} ← process.env.${entry.envVar}`);
  }
  if (entry.data) {
    console.log(`${path} ← secret @ ${entry.data}`);
  }
}
```

Each entry has the shape:

```ts
{ path: string; value?: unknown; default?: unknown; envVar?: string; data?: unknown; type?: TypeTag }
```

`value` is present if a syncronous value is available — useful for distinguishing "already known" from "needs fetching" without resolving anything.

Pass a subtree path to scope iteration to that part of the config. Paths are typed — only subtree paths compile, leaves are rejected.

```ts
for (const [path, entry] of cfg.entries("feature")) {
  // path is e.g. "feature.enabled", "feature.limit"
}
```

### Accepting a config in library code

When you write a function or module that should accept _any_ config whose resolved shape contains the fields you need, use `ConfettiConfig<R>` — a covariant, read-only view keyed on the **resolved** shape:

```ts
import type { ConfettiConfig } from "@jayalfredprufrock/confetti";

type CoreConfig = { appName: string; port: number };

function forRootAsync(opts: { config: ConfettiConfig<CoreConfig> }) {
  const resolved = opts.config("prod").get(); // typed as CoreConfig — no cast
}
```

- Accepts any config whose resolved shape **extends** `CoreConfig` (extra fields are fine).
- Rejects a mismatch **at the call site** — a missing field, or one that resolves to the wrong type, is a compile error.
- No generic type parameter on your function, and `get()`/`resolve()` are properly typed.

`ConfettiConfig<R>` intentionally exposes only the pathless `get()`/`resolve(fetcher)` — the output-position members — which is what makes it covariant in `R`. `Confetti<C>` (what `makeConfig` returns) is assignable to `ConfettiConfig<ResolvedConfig<C>>`, so you just pass it through. If a consumer needs typed **path** access (`get("a.b")`, `entries`), have them take the full `Confetti<C>` instead; it's invariant in `C`, so it can't be widened to a base shape this way.

To name the resolved shape of a specific config value, use `GetConfig<typeof config>`.

## Real-world use cases

### Generate a required env var list for your deploy pipeline

```ts
const required = Array.from(cfg.entries())
  .filter(([, entry]) => entry.envVar && entry.value === undefined)
  .map(([, entry]) => entry.envVar!);
```

### Synthesize Terraform / Pulumi secret resources

```ts
for (const [path, entry] of cfg.entries()) {
  if (!entry.data) continue;
  new aws.secretsmanager.Secret(path, { name: entry.data as string });
}
```

### Fetch everything you need at boot

```ts
const secrets = await cfg.resolve("secrets", async ({ data }) => {
  return await secretsClient
    .getSecretValue({ SecretId: data as string })
    .then((r) => r.SecretString);
});
```

### Validate config is ready before starting

```ts
for (const [path, entry] of cfg.entries()) {
  if (entry.value === undefined && entry.default === undefined && !entry.data) {
    throw new Error(`Config '${path}' has no resolvable value.`);
  }
}
```

## API

| Method             | Signature                                           | Notes                                                                                                  |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `makeConfig`       | `(config \| (env) => config) => Confetti`           | Accepts a config object or factory fn.                                                                 |
| `confetti(env)`    | `(env: string) => Accessor`                         | Binds an environment.                                                                                  |
| `accessor.get`     | `(path?) => value`                                  | Sync. Path is optional — omit to get the full resolved config. Throws if async resolution is required. |
| `accessor.resolve` | `(path?, fetcher) => Promise<value>`                | Async. Path is optional — omit to resolve the full config. Fetcher invoked per leaf that needs it.     |
| `accessor.entries` | `(startPath?) => IterableIterator<[string, Entry]>` | Lazy iterator of every leaf with its metadata; optionally scoped to a subtree.                         |

## TODO

- maybe .map() would be more convenient than entries() iterator?

## License

MIT
