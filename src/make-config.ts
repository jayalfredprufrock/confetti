import { CONFETTI } from "./symbols";
import type { Confetti, Config, ConfigEntry, Fetcher, SubtreePaths, ValidateConfig } from "./types";
import {
  buildEntry,
  entriesIter,
  getAtPath,
  isNestedConfig,
  resolveEntryAsync,
  resolveEntrySync,
  resolveSubtreeAsync,
  resolveSubtreeSync,
} from "./util";

export const makeConfig = <const C extends Config>(
  input: (C & ValidateConfig<C>) | ((env: string) => C & ValidateConfig<C>),
): Confetti<C> => {
  const factory = typeof input === "function" ? input : () => input;

  const confetti = (env: string) => {
    const config = factory(env);

    const get = (path?: string): unknown => {
      if (!path) return resolveSubtreeSync(config, "", env);
      const node = getAtPath(config, path);
      return isNestedConfig(node)
        ? resolveSubtreeSync(node, path, env)
        : resolveEntrySync(buildEntry(node, path, env), env);
    };

    const resolve = async (
      pathOrFetcher: string | Fetcher,
      maybeFetcher?: Fetcher,
    ): Promise<unknown> => {
      if (typeof pathOrFetcher === "function") {
        return resolveSubtreeAsync(config, "", env, pathOrFetcher);
      }
      const path = pathOrFetcher;
      const fetcher = maybeFetcher!;
      const node = getAtPath(config, path);
      return isNestedConfig(node)
        ? resolveSubtreeAsync(node, path, env, fetcher)
        : resolveEntryAsync(buildEntry(node, path, env), env, fetcher);
    };

    const entries = (
      startPath?: SubtreePaths<C> & string,
    ): IterableIterator<[string, ConfigEntry]> => {
      const root = startPath ? getAtPath(config, startPath) : config;
      if (!isNestedConfig(root)) {
        throw new Error(`'${startPath}' is not a config subtree.`);
      }
      return entriesIter(root, env, startPath ? `${startPath}.` : "");
    };

    return { config, get, resolve, entries };
  };

  confetti[CONFETTI] = "CONFETTI" as const;

  return confetti as Confetti<C>;
};
