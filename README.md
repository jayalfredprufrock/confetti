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

Individual values can also be functions, which also provides an escape hatch if you need to provide an object as a config leaf value.

```ts
const config = makeConfig({
  serviceName: (env) => `my-app-${env}`,
  objValue: (env) => ({ enabled: true, value: 42 }),
});
```

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

Supported tags: `"string" | "number" | "boolean" | "string[]" | "number[]" | "boolean[]"`.

**Coercion rules (env vars and string fetcher returns):**

| Tag       | Expected raw                                        |
| --------- | --------------------------------------------------- |
| `string`  | as-is                                               |
| `number`  | `Number(raw)`; empty or `NaN` throws                |
| `boolean` | exactly `"true"` or `"false"`; anything else throws |
| `T[]`     | `JSON.parse` + array check + element type check     |

`[TYPE]` also constrains `[DEFAULT]` and per-env values at compile time — `{ [TYPE]: "number", [DEFAULT]: "nope" }` is a type error.

**When `[ENV]` or `[DATA]` are present without `[TYPE]`:** values are required to be strings (both `[DEFAULT]` and per-env overrides). The fetcher must also return a string. If you need a non-string here, add `[TYPE]`.

### Async reads with `resolve`

`resolve(path, fetcher)` hands off to your code whenever a leaf can't be satisfied synchronously. You decide how to resolve it — read AWS Secrets Manager, call Vault, hit Parameter Store, whatever.

```ts
const password = await cfg.resolve("dbPassword", async (ctx) => {
  // ctx = { env: 'prod', envVar: 'DB_PASSWORD', data: 'prod/db/password', default: '' }
  const secret = await secretsClient.getSecretValue({ SecretId: ctx.data });
  return secret.SecretString;
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

| Method             | Signature                                           | Notes                                                                          |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `makeConfig`       | `(config \| (env) => config) => Confetti`           | Accepts a config object or factory fn.                                         |
| `confetti(env)`    | `(env: string) => Accessor`                         | Binds an environment.                                                          |
| `accessor.get`     | `(path) => value`                                   | Sync. Throws if async resolution is required.                                  |
| `accessor.resolve` | `(path, fetcher) => Promise<value>`                 | Async. Fetcher invoked per leaf that needs it.                                 |
| `accessor.entries` | `(startPath?) => IterableIterator<[string, Entry]>` | Lazy iterator of every leaf with its metadata; optionally scoped to a subtree. |

## License

MIT
