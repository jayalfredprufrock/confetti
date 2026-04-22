import { expectTypeOf, test } from "vite-plus/test";
import { makeConfig } from "./make-config";
import { DATA, DEFAULT, ENV, TYPE } from "./symbols";
import type { ConfigEntry } from "./types";

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
