import { CONFETTI, DATA, DEFAULT, ENV_VAR } from "./symbols";

export type Obj<T = unknown> = Record<string, T>;

export type Primitive = string | number | boolean | null;
export type MaybeArray<T> = T | T[];

export type ConfigVal =
  | MaybeArray<Primitive>
  | ((context: ConfigFlatMapContext) => any)
  | (() => Promise<any>);

export type IsConfigValPerEnv<T> = T extends
  | { [DEFAULT]: any }
  | { [ENV_VAR]: any }
  | { [DATA]: any }
  ? true
  : false;

// TODO: find a way to prevent per env values match the widened default type
export type ConfigValPerEnv<D extends ConfigVal = ConfigVal> = {
  [DEFAULT]?: D;
  [ENV_VAR]?: string;
  [DATA]?: any;
} & Record<string, D>;

export type Config = {
  [key: string]: Config | ConfigVal | ConfigValPerEnv;
};

export type ResolvedValue<V> = V extends (...args: any[]) => any ? Awaited<ReturnType<V>> : V;

export type ResolvedConfig<C> = {
  [K in keyof C]: C[K] extends Obj
    ? IsConfigValPerEnv<C[K]> extends true
      ? C[K] extends ConfigValPerEnv<infer D>
        ? ResolvedValue<D>
        : ResolvedConfig<C[K]>
      : ResolvedConfig<C[K]>
    : ResolvedValue<C[K]>;
};

export type MakeConfig<R extends Config> = (env: string) => Promise<R>;

export type ResolvedEnvVars<C> = {
  [K in keyof C]: C[K] extends ConfigValPerEnv<infer V>
    ? C[K][typeof ENV_VAR] extends string
      ? V
      : undefined
    : C[K] extends Obj
      ? ResolvedEnvVars<C[K]>
      : Awaited<C[K]>;
};

export interface ResolvedSecret {
  secret: string;
  path: string;
  value: unknown;
  envVar?: string;
}

export interface ConfigFlatMapContext {
  path: string;
  unresolvedValue: ConfigVal;
  envVar?: string;
  data?: unknown;
}

export type Confetti<C> = {
  [CONFETTI]: "CONFETTI";
  (env: string): {
    config: C;
    flatMap: <T>(transform: (context: ConfigFlatMapContext) => T | T[]) => T[];
    resolve: () => Promise<ResolvedConfig<C>>;
    resolveSync: () => ResolvedConfig<C>;
    resolveValue: (path: string) => Promise<string>;
    resolveValueSync: (path: string) => string;
    resolveEnv: () => Promise<Obj<string>>;
  };
};

export type GetConfig<T> = T extends Confetti<infer C> ? ResolvedConfig<C> : never;
