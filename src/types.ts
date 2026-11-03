import { DATA, DEFAULT, ENV, TYPE } from "./symbols";

export type Obj<T = unknown> = Record<string, T>;

export type Primitive = string | number | boolean | null;
export type MaybeArray<T> = T | T[];

export type ConfigValFn<T = unknown> = (env: string) => T;
export type ConfigVal = MaybeArray<Primitive> | ConfigValFn<any>;

export type TypeTag = "string" | "number" | "boolean" | "string[]" | "number[]" | "boolean[]";

export type TypeMap = {
  string: string;
  number: number;
  boolean: boolean;
  "string[]": string[];
  "number[]": number[];
  "boolean[]": boolean[];
};

/** A [TYPE] declared as a tuple of allowed literals, e.g. `["debug", "info", "warn"]`. */
export type LiteralTuple = readonly Exclude<Primitive, null>[];

/** Anything valid in the [TYPE] slot: a built-in tag string or a literal tuple. */
export type TypeTagOrLiterals = TypeTag | LiteralTuple;

/** Maps a [TYPE] value to the TypeScript type it resolves to. */
export type ResolveTag<Tag> = Tag extends TypeTag
  ? TypeMap[Tag]
  : Tag extends readonly (infer E)[]
    ? E
    : never;

export type IsConfigValPerEnv<T> = T extends
  | { [DEFAULT]: any }
  | { [ENV]: any }
  | { [DATA]: any }
  | { [TYPE]: any }
  ? true
  : false;

export type ConfigValPerEnvTyped<T extends TypeTagOrLiterals> = {
  readonly [TYPE]: T;
  readonly [DEFAULT]?: ResolveTag<T> | ConfigValFn<ResolveTag<T>>;
  readonly [ENV]?: string;
  readonly [DATA]?: any;
  readonly [key: string]: ResolveTag<T> | ConfigValFn<ResolveTag<T>>;
};

/**
 * The [TYPE] tag implied by a static `[DEFAULT]` when `[TYPE]` is omitted on an `[ENV]`/`[DATA]`
 * leaf: `3000` → `"number"`, `["a"]` → `"string[]"`, etc. `never` when nothing can be inferred
 * (strings, value functions, `null`, empty or mixed arrays) — those fall back to string semantics.
 */
export type InferTag<D> = D extends (...args: any[]) => any
  ? never
  : D extends number
    ? "number"
    : D extends boolean
      ? "boolean"
      : D extends readonly []
        ? never
        : D extends readonly string[]
          ? "string[]"
          : D extends readonly number[]
            ? "number[]"
            : D extends readonly boolean[]
              ? "boolean[]"
              : never;

/** An `[ENV]`/`[DATA]` leaf whose type is inferred from its static `[DEFAULT]` (see {@link InferTag}). */
export type ConfigValPerEnvInferred<T extends TypeTag> = {
  readonly [TYPE]?: never;
  readonly [DEFAULT]: TypeMap[T];
  readonly [ENV]?: string;
  readonly [DATA]?: any;
  readonly [key: string]: TypeMap[T] | ConfigValFn<TypeMap[T]>;
};

export type ConfigValPerEnvFetcher = {
  readonly [TYPE]?: never;
  readonly [DEFAULT]?: string | ConfigValFn<string>;
  readonly [ENV]?: string;
  readonly [DATA]?: any;
  readonly [key: string]: string | ConfigValFn<string> | undefined;
};

export type ConfigValPerEnvPlain<D extends ConfigVal = ConfigVal> = {
  readonly [TYPE]?: never;
  readonly [DEFAULT]?: D;
  readonly [ENV]?: never;
  readonly [DATA]?: never;
  readonly [key: string]: D;
};

export type ConfigValPerEnv =
  | ConfigValPerEnvTyped<TypeTagOrLiterals>
  | ConfigValPerEnvFetcher
  | ConfigValPerEnvPlain;

export type Config = {
  [key: string]: Config | ConfigVal | ConfigValPerEnv;
};

/**
 * The `makeConfig` constraint. Deliberately a single (non-union) recursive object type: it
 * supplies contextual types — `env` in value functions, mutable arrays under `const`
 * inference — without the cost of relating every node against the {@link Config} union.
 * Per-node correctness (e.g. `[DEFAULT]` matching `[TYPE]`) is enforced by {@link ValidateConfig}.
 */
export type ConfigInput = {
  readonly [TYPE]?: TypeTagOrLiterals;
  readonly [DEFAULT]?: ConfigVal;
  readonly [ENV]?: string;
  readonly [DATA]?: any;
  readonly [key: string]: ConfigVal | ConfigInput;
};

export type ValidateConfig<C> = {
  [K in keyof C]: C[K] extends { [TYPE]: infer T extends TypeTagOrLiterals }
    ? ConfigValPerEnvTyped<T>
    : C[K] extends { [TYPE]: any }
      ? ConfigValPerEnvTyped<TypeTagOrLiterals>
      : C[K] extends { [ENV]: any } | { [DATA]: any }
        ? C[K] extends { [DEFAULT]: infer D }
          ? [InferTag<D>] extends [never]
            ? ConfigValPerEnvFetcher
            : ConfigValPerEnvInferred<InferTag<D>>
          : ConfigValPerEnvFetcher
        : C[K] extends { [DEFAULT]: any }
          ? C[K] extends { readonly [key: string]: ConfigVal | undefined }
            ? C[K]
            : ConfigValPerEnvPlain
          : C[K] extends Obj
            ? ValidateConfig<C[K]>
            : C[K];
};

type WidenLiteral<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T extends readonly (infer E)[]
        ? WidenLiteral<E>[]
        : T;

export type ResolvedValue<V> = V extends (...args: any[]) => any
  ? Awaited<ReturnType<V>>
  : WidenLiteral<V>;

export type ResolvedConfig<C> = {
  [K in keyof C]: C[K] extends Obj
    ? IsConfigValPerEnv<C[K]> extends true
      ? ResolveNode<C[K]>
      : ResolvedConfig<C[K]>
    : ResolvedValue<C[K]>;
};

type IsNestedConfig<T> = T extends Obj ? (IsConfigValPerEnv<T> extends true ? false : true) : false;

export type Paths<C> = C extends Obj
  ? {
      [K in keyof C & string]: IsNestedConfig<C[K]> extends true
        ? K | `${K}.${Paths<C[K]> & string}`
        : K;
    }[keyof C & string]
  : never;

export type SubtreePaths<C> = C extends Obj
  ? {
      [K in keyof C & string]: IsNestedConfig<C[K]> extends true
        ? K | `${K}.${SubtreePaths<C[K]> & string}`
        : never;
    }[keyof C & string]
  : never;

type ResolveNode<T> = T extends Obj
  ? IsConfigValPerEnv<T> extends true
    ? T extends { [TYPE]: infer Tag extends TypeTagOrLiterals }
      ? ResolveTag<Tag>
      : T extends { [ENV]: any } | { [DATA]: any }
        ? T extends { [DEFAULT]: infer D }
          ? [InferTag<D>] extends [never]
            ? string
            : TypeMap[InferTag<D>]
          : string
        : T extends ConfigValPerEnvPlain<infer D>
          ? ResolvedValue<D>
          : never
    : ResolvedConfig<T>
  : ResolvedValue<T>;

export type ValueAtPath<C, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof C
    ? ValueAtPath<C[Head], Rest>
    : never
  : P extends keyof C
    ? ResolveNode<C[P]>
    : never;

export interface FetcherContext<D = unknown> {
  env: string;
  default?: D;
  envVar?: string;
  data?: unknown;
  type?: TypeTagOrLiterals;
}

export type Fetcher<D = unknown, T = unknown> = (
  context: FetcherContext<D>,
) => Promise<T | undefined>;

export interface ConfigEntry {
  path: string;
  value?: unknown;
  default?: unknown;
  envVar?: string;
  data?: unknown;
  type?: TypeTagOrLiterals;
}

export type Confetti<C> = {
  (env: string): {
    config: C;
    get(): ResolvedConfig<C>;
    get<P extends Paths<C> & string>(path: P): ValueAtPath<C, P>;
    resolve(fetcher: Fetcher): Promise<ResolvedConfig<C>>;
    resolve<P extends Paths<C> & string>(path: P, fetcher: Fetcher): Promise<ValueAtPath<C, P>>;
    entries(startPath?: SubtreePaths<C> & string): IterableIterator<[string, ConfigEntry]>;
  };
};

export type GetConfig<T> = T extends Confetti<infer C> ? ResolvedConfig<C> : never;

/**
 * A covariant, read-only view of a {@link Confetti}, keyed on its *resolved* shape `R`
 * rather than its raw input shape `C`.
 *
 * {@link Confetti}`<C>` is invariant in `C`: it exposes `config: C` and the path-typed
 * `get<P>`/`resolve<P>`/`entries` overloads, all of which put `C` in an input position.
 * That prevents a consumer from writing "accepts any config that resolves to (a supertype
 * of) my base" without resorting to `GetConfig<T> extends Base ? …` generic gymnastics.
 *
 * This view exposes only the output-position members, so it is covariant in `R` — and
 * `Confetti<C>` is structurally assignable to `ConfettiConfig<ResolvedConfig<C>>` (it has
 * these members plus more). A consumer can therefore accept a resolved shape by name, with
 * no generic parameter and no cast:
 *
 * ```ts
 * function forRootAsync(opts: { config: ConfettiConfig<CoreConfig> }) {
 *   const resolved = opts.config("prod").get(); // typed as CoreConfig
 * }
 * ```
 *
 * Passing a `Confetti<C>` whose resolved shape does not extend `CoreConfig` is a compile
 * error at the call site. Consumers that need path access take the full {@link Confetti}`<C>`
 * (and its invariance) instead.
 *
 * Key it on the resolved type (`R = ResolvedConfig<C>`) — the raw shape with its
 * `[DEFAULT]`/`[ENV]`/… symbols is an implementation detail consumers shouldn't have to name.
 * Keep the members output-only: adding `config: R`, a path overload, or `entries` would put
 * `R` back in input position and reintroduce invariance.
 */
export type ConfettiConfig<R> = {
  (env: string): {
    get(): R;
    resolve(fetcher: Fetcher): Promise<R>;
  };
};

/** A leaf value confetti can hold directly (anything else needs a value function). */
export type LeafValue = Primitive | readonly Primitive[];

/** [TYPE] values whose resolved type is assignable to `T`. */
type TagsFor<T> =
  | { [K in TypeTag]: TypeMap[K] extends T ? K : never }[TypeTag]
  | ([Extract<T, Exclude<Primitive, null>>] extends [never]
      ? never
      : readonly Extract<T, Exclude<Primitive, null>>[]);

/**
 * Opt-in typing for one per-env leaf, for use with `satisfies` when a type already exists:
 *
 * ```ts
 * port: { [ENV]: "PORT", [DEFAULT]: 3000, prod: 443 } satisfies PerEnv<number>,
 * ```
 *
 * Gives completions and checks every env value, `[DEFAULT]` and `[TYPE]` against `T`. Type-only:
 * the resolved type is still inferred from the literal. `T` must be a leaf type — objects belong
 * in a nested section or a value function.
 */
export type PerEnv<T extends LeafValue> = {
  readonly [TYPE]?: TagsFor<T>;
  readonly [DEFAULT]?: T | ConfigValFn<T>;
  readonly [ENV]?: string;
  readonly [DATA]?: any;
  readonly [key: string]: T | ConfigValFn<T> | undefined;
};

type IsPlainObj<T> = T extends readonly unknown[]
  ? false
  : T extends (...args: any[]) => any
    ? false
    : T extends object
      ? true
      : false;

type LeafNodeOf<T extends LeafValue> = T | ConfigValFn<T> | PerEnv<T>;

type ObjNodeOf<T> = T extends unknown
  ? IsPlainObj<T> extends true
    ? ConfigOf<T> | ConfigValFn<T>
    : ConfigValFn<T>
  : never;

type ConfigNodeOf<T> =
  | ([Extract<T, LeafValue>] extends [never] ? never : LeafNodeOf<Extract<T, LeafValue>>)
  | ObjNodeOf<Exclude<T, LeafValue | undefined>>;

/**
 * The config input that resolves to `S`, for use with `satisfies` on a whole config or a section:
 *
 * ```ts
 * makeConfig({ ... } satisfies ConfigOf<AppConfig>);
 * makeConfig((env) => ({ ... }) satisfies ConfigOf<AppConfig>);
 * makeConfig({ waf: { ... } satisfies ConfigOf<WafConfig> });
 * ```
 *
 * Each key accepts a plain value, a value function, a per-env block ({@link PerEnv}), or — for
 * object values — a nested section. Gives completions at every level and flags missing,
 * misspelled and mistyped keys. Type-only: the resolved type is still inferred from the literal.
 */
export type ConfigOf<S> = {
  readonly [K in keyof S]: ConfigNodeOf<S[K]>;
};
