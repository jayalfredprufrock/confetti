import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { makeConfig } from "./make-config";
import { DATA, DEFAULT, ENV, TYPE } from "./symbols";

describe("makeConfig — input forms", () => {
  test("accepts a plain config object", () => {
    const config = makeConfig({ numberProp: 42, booleanProp: true });
    expect(config("dev").get("numberProp")).toBe(42);
    expect(config("dev").get("booleanProp")).toBe(true);
  });

  test("accepts a factory fn of env", () => {
    const config = makeConfig((env: string) => ({ stringProp: `${env}-string` }));
    expect(config("dev").get("stringProp")).toBe("dev-string");
    expect(config("prod").get("stringProp")).toBe("prod-string");
  });
});

describe("get — precedence", () => {
  const ENV_VAR_NAME = "CONFETTI_TEST_VAR";

  beforeEach(() => {
    delete process.env[ENV_VAR_NAME];
  });
  afterEach(() => {
    delete process.env[ENV_VAR_NAME];
  });

  test("picks the matching env key over default", () => {
    const config = makeConfig({
      prop: { [DEFAULT]: "default", staging: "staging-value", prod: "prod-value" },
    });
    expect(config("staging").get("prop")).toBe("staging-value");
    expect(config("prod").get("prop")).toBe("prod-value");
    expect(config("dev").get("prop")).toBe("default");
  });

  test("env var overrides explicit env value", () => {
    process.env[ENV_VAR_NAME] = "from-env-var";
    const config = makeConfig({
      prop: { [ENV]: ENV_VAR_NAME, [DEFAULT]: "default", prod: "prod-value" },
    });
    expect(config("prod").get("prop")).toBe("from-env-var");
  });

  test("env var is kept as raw string when no [TYPE] is specified", () => {
    process.env[ENV_VAR_NAME] = "just-a-string";
    const config = makeConfig({
      prop: { [ENV]: ENV_VAR_NAME, [DEFAULT]: "default" },
    });
    expect(config("dev").get("prop")).toBe("just-a-string");
  });

  test("throws when no sync source is available", () => {
    const config = makeConfig({
      secret: { [ENV]: "UNSET_VAR", [DATA]: "some-data" },
    });
    expect(() => config("dev").get("secret")).toThrow(/requires async resolution/);
  });

  test("throws on invalid path", () => {
    const config = makeConfig({ prop: "value" });
    expect(() => (config("dev") as any).get("missing")).toThrow(/Invalid config path/);
  });
});

describe("get — subtree", () => {
  test("returns the nested object", () => {
    const config = makeConfig({
      nested: {
        prop: "prop value",
        perEnvProp: { [DEFAULT]: "default value", staging: "staging value" },
      },
    });
    expect(config("staging").get("nested")).toEqual({
      prop: "prop value",
      perEnvProp: "staging value",
    });
  });

  test("throws when a descendant leaf requires async", () => {
    const config = makeConfig({
      group: {
        a: "static",
        b: { [DATA]: "remote-only" },
      },
    });
    expect(() => config("dev").get("group")).toThrow(/requires async resolution/);
  });
});

describe("resolve — fetcher behavior", () => {
  test("invokes fetcher for per-env leaves missing a sync value", async () => {
    const config = makeConfig({
      secret: { [ENV]: "SECRET_VAR", [DATA]: "aws-secret-name", [DEFAULT]: "" },
    });
    const fetched = await config("prod").resolve("secret", async (ctx) => {
      expect(ctx.env).toBe("prod");
      expect(ctx.envVar).toBe("SECRET_VAR");
      expect(ctx.data).toBe("aws-secret-name");
      expect(ctx.default).toBe("");
      return "resolved-secret";
    });
    expect(fetched).toBe("resolved-secret");
  });

  test("skips fetcher when a sync value is present (explicit env)", async () => {
    const config = makeConfig({
      prop: { [DATA]: "data", [DEFAULT]: "default", prod: "prod-value" },
    });
    let called = false;
    const result = await config("prod").resolve("prop", async () => {
      called = true;
      return "fetched";
    });
    expect(result).toBe("prod-value");
    expect(called).toBe(false);
  });

  test("skips fetcher when an env var is set", async () => {
    process.env.RESOLVE_ENV_VAR = "from-env";
    try {
      const config = makeConfig({
        prop: { [ENV]: "RESOLVE_ENV_VAR", [DATA]: "data" },
      });
      let called = false;
      const result = await config("dev").resolve("prop", async () => {
        called = true;
        return "fetched";
      });
      expect(result).toBe("from-env");
      expect(called).toBe(false);
    } finally {
      delete process.env.RESOLVE_ENV_VAR;
    }
  });

  test("falls back to default when fetcher returns undefined", async () => {
    const config = makeConfig({
      prop: { [DATA]: "remote", [DEFAULT]: "fallback" },
    });
    const result = await config("dev").resolve("prop", async () => undefined);
    expect(result).toBe("fallback");
  });

  test("throws when fetcher returns undefined and there is no default", async () => {
    const config = makeConfig({
      prop: { [DATA]: "remote" },
    });
    await expect(config("dev").resolve("prop", async () => undefined)).rejects.toThrow(
      /Unable to resolve/,
    );
  });

  test("resolves a subtree by fetching only the leaves that need it", async () => {
    const config = makeConfig({
      group: {
        a: "static",
        b: { [DEFAULT]: "default-b" },
        c: { [DATA]: "remote-c" },
      },
    });
    const calls: string[] = [];
    const result = await config("dev").resolve("group", async (ctx) => {
      calls.push(String(ctx.data));
      return "fetched-c";
    });
    expect(result).toEqual({ a: "static", b: "default-b", c: "fetched-c" });
    expect(calls).toEqual(["remote-c"]);
  });
});

describe("entries", () => {
  test("iterates lazily — pulling one entry doesn't consume the rest", () => {
    let functionCalls = 0;
    const config = makeConfig({
      a: () => {
        functionCalls++;
        return "a";
      },
      b: () => {
        functionCalls++;
        return "b";
      },
    });
    const iter = config("dev").entries();
    iter.next();
    // Entry generator doesn't invoke functions — it only surfaces metadata.
    // But it's also true we haven't even walked past `a` yet.
    expect(functionCalls).toBe(0);
  });

  test("accepts a startPath to iterate a subtree", () => {
    const config = makeConfig({
      top: "t",
      group: {
        x: 1,
        y: { [DEFAULT]: "dy", prod: "py" },
        deeper: { z: true },
      },
    });
    const paths = Array.from(config("prod").entries("group"), ([p]) => p).sort();
    expect(paths).toEqual(["group.deeper.z", "group.x", "group.y"]);
  });

  test("startPath on a leaf throws", () => {
    const config = makeConfig({ leaf: "v" });
    expect(() => (config("dev") as any).entries("leaf")).toThrow(/not a config subtree/);
  });

  test("yields every leaf with its metadata", () => {
    const config = makeConfig({
      flat: "value",
      arr: [1, 2, 3],
      nested: {
        inner: 10,
        perEnv: { [DEFAULT]: "d", [ENV]: "ENTRIES_VAR", [DATA]: "secret-name", prod: "p" },
      },
    });
    const entries = Array.from(config("prod").entries());
    const paths = entries.map(([p]) => p).sort();
    expect(paths).toEqual(["arr", "flat", "nested.inner", "nested.perEnv"]);

    const byPath = Object.fromEntries(entries);
    expect(byPath["flat"]).toEqual({ path: "flat", value: "value" });
    expect(byPath["arr"]).toEqual({ path: "arr", value: [1, 2, 3] });
    expect(byPath["nested.perEnv"]).toEqual({
      path: "nested.perEnv",
      value: "p",
      default: "d",
      envVar: "ENTRIES_VAR",
      data: "secret-name",
    });
  });
});

describe("dynamic value functions", () => {
  test("top-level function leaf receives env", () => {
    const config = makeConfig({
      greeting: (env: string) => `hello-${env}`,
    });
    expect(config("staging").get("greeting")).toBe("hello-staging");
    expect(config("prod").get("greeting")).toBe("hello-prod");
  });

  test("function as [DEFAULT] inside per-env block", () => {
    const config = makeConfig({
      prop: { [DEFAULT]: (env: string) => `default-${env}`, prod: "prod-value" },
    });
    expect(config("dev").get("prop")).toBe("default-dev");
    expect(config("prod").get("prop")).toBe("prod-value");
  });

  test("function as per-env key", () => {
    const config = makeConfig({
      prop: { [DEFAULT]: "d", staging: (env: string) => `${env}-computed` },
    });
    expect(config("staging").get("prop")).toBe("staging-computed");
  });

  test("get throws on async function leaves", () => {
    const config = makeConfig({
      obj: async () => ({ inner: 1 }),
    });
    expect(() => config("dev").get("obj")).toThrow(/requires async resolution/);
  });

  test("resolve awaits async function leaves and passes env", async () => {
    const config = makeConfig({
      obj: async (env: string) => ({ env }),
      sync: (env: string) => `sync-${env}`,
    });
    const c = config("prod");
    expect(await c.resolve("obj", async () => undefined)).toEqual({ env: "prod" });
    expect(await c.resolve("sync", async () => undefined)).toBe("sync-prod");
  });

  test("function form lets you store a full object as a single leaf value", () => {
    const config = makeConfig({
      // objects in leaf position are normally walked as nested paths;
      // wrapping in a function makes them a single opaque leaf value.
      clientOptions: () => ({ retries: 3, timeout: 500, headers: { "x-app": "foo" } }),
    });
    const c = config("dev");
    expect(c.get("clientOptions")).toEqual({
      retries: 3,
      timeout: 500,
      headers: { "x-app": "foo" },
    });
    // and it's a leaf — no deeper paths
    const paths = Array.from(c.entries(), ([p]) => p);
    expect(paths).toEqual(["clientOptions"]);
  });
});

describe("[TYPE] — env var coercion", () => {
  const VAR = "CONFETTI_TYPE_VAR";
  beforeEach(() => {
    delete process.env[VAR];
  });
  afterEach(() => {
    delete process.env[VAR];
  });

  test("coerces env var to number", () => {
    process.env[VAR] = "8080";
    const config = makeConfig({
      port: { [TYPE]: "number", [ENV]: VAR, [DEFAULT]: 3000 },
    });
    expect(config("dev").get("port")).toBe(8080);
  });

  test("coerces env var to boolean", () => {
    process.env[VAR] = "true";
    const config = makeConfig({
      flag: { [TYPE]: "boolean", [ENV]: VAR, [DEFAULT]: false },
    });
    expect(config("dev").get("flag")).toBe(true);
  });

  test("coerces env var to number[] via JSON", () => {
    process.env[VAR] = "[1,2,3]";
    const config = makeConfig({
      ids: { [TYPE]: "number[]", [ENV]: VAR, [DEFAULT]: [] },
    });
    expect(config("dev").get("ids")).toEqual([1, 2, 3]);
  });

  test("throws when env var cannot be coerced to number", () => {
    process.env[VAR] = "not-a-number";
    const config = makeConfig({
      port: { [TYPE]: "number", [ENV]: VAR, [DEFAULT]: 3000 },
    });
    expect(() => config("dev").get("port")).toThrow(/Cannot coerce/);
  });

  test("throws on non-strict boolean strings", () => {
    process.env[VAR] = "yes";
    const config = makeConfig({
      flag: { [TYPE]: "boolean", [ENV]: VAR, [DEFAULT]: false },
    });
    expect(() => config("dev").get("flag")).toThrow(/Cannot coerce/);
  });

  test("throws on array element mismatch", () => {
    process.env[VAR] = '["a", 2]';
    const config = makeConfig({
      ids: { [TYPE]: "number[]", [ENV]: VAR, [DEFAULT]: [] },
    });
    expect(() => config("dev").get("ids")).toThrow(/Cannot coerce/);
  });

  test("leaves raw string when no [TYPE] is specified", () => {
    process.env[VAR] = "3000";
    const config = makeConfig({
      port: { [ENV]: VAR, [DEFAULT]: "unset" },
    });
    expect(config("dev").get("port")).toBe("3000");
  });
});

describe("[TYPE] — fetcher coercion", () => {
  test("coerces string fetcher return per [TYPE]", async () => {
    const config = makeConfig({
      port: { [TYPE]: "number", [DATA]: "remote-port" },
    });
    const result = await config("dev").resolve("port", async () => "5432");
    expect(result).toBe(5432);
  });

  test("accepts non-string fetcher return when it matches [TYPE]", async () => {
    const config = makeConfig({
      port: { [TYPE]: "number", [DATA]: "remote-port" },
    });
    const result = await config("dev").resolve("port", async () => 5432);
    expect(result).toBe(5432);
  });

  test("throws when fetcher returns non-string that doesn't match [TYPE]", async () => {
    const config = makeConfig({
      port: { [TYPE]: "number", [DATA]: "remote-port" },
    });
    await expect(
      config("dev").resolve("port", async () => true as unknown as number),
    ).rejects.toThrow(/doesn't match \[TYPE\]/);
  });

  test("throws when fetcher returns non-string and no [TYPE] was specified", async () => {
    const config = makeConfig({
      secret: { [DATA]: "remote" },
    });
    await expect(
      config("dev").resolve("secret", async () => 123 as unknown as string),
    ).rejects.toThrow(/must return a string/);
  });

  test("passes [TYPE] to the fetcher context", async () => {
    const config = makeConfig({
      port: { [TYPE]: "number", [DATA]: "remote-port" },
    });
    let seen: string | undefined;
    await config("dev").resolve("port", async (ctx) => {
      seen = ctx.type;
      return 1;
    });
    expect(seen).toBe("number");
  });
});
