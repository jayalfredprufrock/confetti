import { expectTypeOf, test } from "vite-plus/test";
import { makeConfig } from "./make-config";
import { DATA, DEFAULT, ENV, TYPE } from "./symbols";
import type { ConfettiConfig, ConfigEntry } from "./types";

const config = makeConfig({
  numberProp: 42,
  booleanProp: true,
  stringProp: "hello",
  arr: [1, 2, 3],

  secretStringProp: {
    [ENV]: "SECRET_VAR",
    [DEFAULT]: "",
    [DATA]: "aws-secret-name",
  },

  nested: {
    prop: "prop value",
    perEnvProp: {
      [DEFAULT]: "default value",
      staging: "staging value",
      prod: "prod value",
    },
  },

  obj: (env: string) => ({ inner: env.length }),
  asyncObj: async () => ({ remote: true }),

  greeting: (env: string) => `hello-${env}`,

  dynamicDefault: {
    [DEFAULT]: (env: string) => `default-${env}`,
    prod: "prod-value",
  },
});

const c = config("dev");

test("get — primitive leaves", () => {
  expectTypeOf(c.get("numberProp")).toEqualTypeOf<number>();
  expectTypeOf(c.get("booleanProp")).toEqualTypeOf<boolean>();
  expectTypeOf(c.get("stringProp")).toEqualTypeOf<string>();
  expectTypeOf(c.get("arr")).toEqualTypeOf<number[]>();
});

test("get — per-env leaf uses [DEFAULT] type", () => {
  expectTypeOf(c.get("secretStringProp")).toEqualTypeOf<string>();
  expectTypeOf(c.get("nested.perEnvProp")).toEqualTypeOf<string>();
});

test("get — nested leaf", () => {
  expectTypeOf(c.get("nested.prop")).toEqualTypeOf<string>();
});

test("get — subtree returns resolved nested shape", () => {
  const nested = c.get("nested");
  const _forward: { prop: string; perEnvProp: string } = nested;
  const _back: typeof nested = { prop: "", perEnvProp: "" };
  void _forward;
  void _back;
});

test("get — function leaves unwrap to awaited return", () => {
  expectTypeOf(c.get("obj")).toEqualTypeOf<{ inner: number }>();
  expectTypeOf(c.get("asyncObj")).toEqualTypeOf<{ remote: boolean }>();
  expectTypeOf(c.get("greeting")).toEqualTypeOf<string>();
  expectTypeOf(c.get("dynamicDefault")).toEqualTypeOf<string>();
});

test("resolve — mirrors get, wrapped in Promise", async () => {
  expectTypeOf(c.resolve("numberProp", async () => undefined)).toEqualTypeOf<Promise<number>>();
  expectTypeOf(c.resolve("secretStringProp", async () => undefined)).toEqualTypeOf<
    Promise<string>
  >();
  const nestedResult = c.resolve("nested", async () => undefined);
  const _a: Promise<{ prop: string; perEnvProp: string }> = nestedResult;
  const _b: typeof nestedResult = null as unknown as Promise<{
    prop: string;
    perEnvProp: string;
  }>;
  void _a;
  void _b;
});

test("entries — typed iterator", () => {
  expectTypeOf(c.entries()).toEqualTypeOf<IterableIterator<[string, ConfigEntry]>>();
});

test("invalid paths are rejected at compile time", () => {
  // @ts-expect-error — not a key of the config
  c.get("missing");
  // @ts-expect-error — not a nested key
  c.get("nested.missing");
  // @ts-expect-error — per-env leaves are not traversable
  c.get("nested.perEnvProp.staging");
});

test("[TYPE] drives the inferred return type", () => {
  const typed = makeConfig({
    port: { [TYPE]: "number", [ENV]: "PORT", [DEFAULT]: 3000 },
    flag: { [TYPE]: "boolean", [DATA]: "flag-name" },
    tags: { [TYPE]: "string[]", [DATA]: "tags-key" },
  })("dev");

  expectTypeOf(typed.get("port")).toEqualTypeOf<number>();
  expectTypeOf(typed.get("flag")).toEqualTypeOf<boolean>();
  expectTypeOf(typed.get("tags")).toEqualTypeOf<string[]>();
});

test("[ENV]/[DATA] without [TYPE] infers string", () => {
  const untyped = makeConfig({
    secret: { [DATA]: "aws/key", [DEFAULT]: "" },
    envOnly: { [ENV]: "SOME_VAR" },
  })("dev");

  expectTypeOf(untyped.get("secret")).toEqualTypeOf<string>();
  expectTypeOf(untyped.get("envOnly")).toEqualTypeOf<string>();
});

test("[TYPE] constrains sibling [DEFAULT] and per-env values", () => {
  // @ts-expect-error — default must be number when [TYPE] is "number"
  makeConfig({ port: { [TYPE]: "number", [DEFAULT]: "not-a-number" } });

  // @ts-expect-error — per-env value must be number when [TYPE] is "number"
  makeConfig({ port: { [TYPE]: "number", [DEFAULT]: 3000, prod: "nope" } });

  // valid — all siblings are numbers
  makeConfig({
    port: { [TYPE]: "number", [DEFAULT]: 3000, prod: 8080 },
  });
});

test("factory form preserves inferred literal types", () => {
  const factoryConfig = makeConfig((env: string) => ({
    numberProp: 42,
    stringProp: `val-${env}`,
    typed: { [TYPE]: "number", [ENV]: "X", [DEFAULT]: 7 },
    secret: { [DATA]: "s", [DEFAULT]: "" },
  }))("dev");

  expectTypeOf(factoryConfig.get("numberProp")).toEqualTypeOf<number>();
  expectTypeOf(factoryConfig.get("stringProp")).toEqualTypeOf<string>();
  expectTypeOf(factoryConfig.get("typed")).toEqualTypeOf<number>();
  expectTypeOf(factoryConfig.get("secret")).toEqualTypeOf<string>();
});

test("get()/resolve() without a path returns the full resolved config", async () => {
  const full = c.get();
  const _fullForward: { numberProp: number; stringProp: string } = full;
  void _fullForward;

  const fullAsync = c.resolve(async () => undefined);
  expectTypeOf(fullAsync).resolves.toHaveProperty("numberProp");
});

test("[ENV]/[DATA] without [TYPE] rejects non-string defaults", () => {
  // @ts-expect-error — no [TYPE], so default must be string
  makeConfig({ port: { [ENV]: "PORT", [DEFAULT]: 3000 } });
});

type CoreConfig = { appName: string; port: number };

test("ConfettiConfig — Confetti<C> is assignable to the resolved-view of its shape", () => {
  const appConfig = makeConfig({ appName: "svc", port: 3000, extra: true });

  // structurally assignable — no cast, no generic
  const view: ConfettiConfig<CoreConfig> = appConfig;

  // .get()/.resolve() are typed as the base shape
  expectTypeOf(view("prod").get()).toEqualTypeOf<CoreConfig>();
  expectTypeOf(view("prod").resolve(async () => undefined)).toEqualTypeOf<Promise<CoreConfig>>();
});

test("ConfettiConfig — consumer accepts any config whose resolved shape extends the base", () => {
  // no generic type parameter on the consumer
  const forRootAsync = (opts: { config: ConfettiConfig<CoreConfig> }) => opts.config("prod").get();

  const wider = makeConfig({ appName: "svc", port: 3000, region: "us-east-1", nested: { a: 1 } });
  expectTypeOf(forRootAsync({ config: wider })).toEqualTypeOf<CoreConfig>();

  const missingPort = makeConfig({ appName: "svc" });
  // @ts-expect-error — resolved shape lacks `port`, so it isn't a ConfettiConfig<CoreConfig>
  forRootAsync({ config: missingPort });

  const wrongType = makeConfig({ appName: "svc", port: "nope" });
  // @ts-expect-error — `port` resolves to string, not number
  forRootAsync({ config: wrongType });
});

test("ConfettiConfig — covariant in R", () => {
  const appConfig = makeConfig({ appName: "svc", port: 3000 });
  const specific: ConfettiConfig<CoreConfig> = appConfig;
  // widening to a supertype view is allowed (covariance)
  const wider: ConfettiConfig<{ appName: string }> = specific;
  expectTypeOf(wider("prod").get()).toEqualTypeOf<{ appName: string }>();
});

test("[TYPE] as a literal tuple resolves to the union", () => {
  const c = makeConfig({
    logLevel: { [TYPE]: ["debug", "info", "warn", "error"], [ENV]: "LOG_LEVEL", [DEFAULT]: "info" },
    port: { [TYPE]: [80, 443, 8080], [DEFAULT]: 80 },
  })("dev");

  expectTypeOf(c.get("logLevel")).toEqualTypeOf<"debug" | "info" | "warn" | "error">();
  expectTypeOf(c.get("port")).toEqualTypeOf<80 | 443 | 8080>();
});

test("[TYPE] as a mixed-kind literal tuple resolves to the union", () => {
  const c = makeConfig({
    retries: { [TYPE]: ["auto", 0, 1, 3], [ENV]: "RETRIES", [DEFAULT]: "auto" },
  })("dev");

  expectTypeOf(c.get("retries")).toEqualTypeOf<"auto" | 0 | 1 | 3>();

  // @ts-expect-error — default must still be a member of the mixed set
  makeConfig({ retries: { [TYPE]: ["auto", 0, 1], [DEFAULT]: 5 } });
});

test("literal tuple [TYPE] constrains [DEFAULT] and per-env values", () => {
  // @ts-expect-error — default must be a member of the tuple
  makeConfig({ logLevel: { [TYPE]: ["debug", "info"], [DEFAULT]: "nope" } });

  // @ts-expect-error — per-env value must be a member of the tuple
  makeConfig({ logLevel: { [TYPE]: ["debug", "info"], [DEFAULT]: "info", prod: "nope" } });

  // valid — all siblings are members
  makeConfig({
    logLevel: { [TYPE]: ["debug", "info"], [DEFAULT]: "info", prod: "debug" },
  });
});
