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

export type ValidateConfig<C> = {
  [K in keyof C]: C[K] extends { [TYPE]: infer T extends TypeTagOrLiterals }
    ? ConfigValPerEnvTyped<T>
    : C[K] extends { [ENV]: any } | { [DATA]: any }
      ? ConfigValPerEnvFetcher
      : C[K] extends { [DEFAULT]: any }
        ? C[K]
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
        ? string
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
