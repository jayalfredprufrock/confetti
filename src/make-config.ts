import { CONFETTI } from "./symbols";
import type { Confetti, Config, ConfigFlatMapContext, Obj, ResolvedConfig } from "./types";
import { configFlatMap, setAtPath } from "./util";

export const makeConfig = <C extends Config>(makeConfig: (env: string) => C): Confetti<C> => {
  const confetti = (env: string) => {
    const config = makeConfig(env);

    const flatMap = <T>(transform: (context: ConfigFlatMapContext) => T | T[]) =>
      configFlatMap<T>(env, config, transform);

    const contextByPath = Object.fromEntries(flatMap((context) => [[context.path, context]]));

    const resolveValue = async (path: string): Promise<any> => {
      const context = contextByPath[path];
      if (!context) throw new Error(`Invalid config path '${path}'.`);
      const { unresolvedValue } = context;
      const value =
        typeof unresolvedValue === "function" ? await unresolvedValue(context) : unresolvedValue;
      if (value === undefined) {
        throw new Error(`Config value at '${path}' resolved to undefined.`);
      }
      return value;
    };

    const resolveValueSync = (path: string): any => {
      const context = contextByPath[path];
      if (!context) throw new Error(`Invalid config path '${path}'.`);
      const { unresolvedValue } = context;
      if (typeof unresolvedValue === "function") {
        throw new Error(`Cannot resolve config value at "${path}" synchronously.`);
      }
      return unresolvedValue;
    };

    const resolve = async (): Promise<any> => {
      const resolvedConfig: Obj = {};
      const promises = Object.keys(contextByPath).map(async (path) => {
        return resolveValue(path).then((resolvedValue) =>
          setAtPath(resolvedConfig, path, resolvedValue),
        );
      });

      await Promise.all(promises);

      return resolvedConfig;
    };

    const resolveSync = (): any => {
      const resolvedConfig: Obj = {};
      for (const path of Object.keys(contextByPath)) {
        setAtPath(resolvedConfig, path, resolveValueSync(path));
      }
      return resolvedConfig as ResolvedConfig<C>;
    };

    const resolveEnv = async (): Promise<any> => {
      const envVars: Obj<string> = {};
      const promises = Object.values(contextByPath).flatMap(async (context) => {
        const { envVar } = context;
        if (!envVar) return [];
        return resolveValue(context.path).then((resolvedValue) => {
          envVars[envVar] = JSON.stringify(resolvedValue);
        });
      });

      await Promise.all(promises);

      return envVars;
    };

    return {
      config,
      flatMap,
      resolveValue,
      resolveValueSync,
      resolve,
      resolveSync,
      resolveEnv,
    };
  };

  confetti[CONFETTI] = "CONFETTI" as const;

  return confetti;
};
