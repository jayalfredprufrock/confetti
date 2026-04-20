import { CONFETTI, DATA, DEFAULT, ENV, TYPE } from "./symbols";

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

export type IsConfigValPerEnv<T> = T extends
  | { [DEFAULT]: any }
  | { [ENV]: any }
  | { [DATA]: any }
  | { [TYPE]: any }
  ? true
  : false;

export type ConfigValPerEnvTyped<T extends TypeTag> = {
  readonly [TYPE]: T;
  readonly [DEFAULT]?: TypeMap[T] | ConfigValFn<TypeMap[T]>;
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
  | ConfigValPerEnvTyped<TypeTag>
  | ConfigValPerEnvFetcher
  | ConfigValPerEnvPlain;

export type Config = {
  [key: string]: Config | ConfigVal | ConfigValPerEnv;
};

export type ValidateConfig<C> = {
  [K in keyof C]: C[K] extends { [TYPE]: infer T extends TypeTag }
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
    ? T extends { [TYPE]: infer Tag extends TypeTag }
      ? TypeMap[Tag]
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
  type?: TypeTag;
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
  type?: TypeTag;
}

export type Confetti<C> = {
  [CONFETTI]: "CONFETTI";
  (env: string): {
    config: C;
    get<P extends Paths<C> & string>(path: P): ValueAtPath<C, P>;
    resolve<P extends Paths<C> & string>(path: P, fetcher: Fetcher): Promise<ValueAtPath<C, P>>;
    entries(startPath?: SubtreePaths<C> & string): IterableIterator<[string, ConfigEntry]>;
  };
};

export type GetConfig<T> = T extends Confetti<infer C> ? ResolvedConfig<C> : never;
