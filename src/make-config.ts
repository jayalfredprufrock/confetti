import { CONFETTI } from "./symbols";
import type {
  Confetti,
  Config,
  ConfigEntry,
  Fetcher,
  Paths,
  SubtreePaths,
  ValidateConfig,
  ValueAtPath,
} from "./types";
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

    const get = <P extends Paths<C> & string>(path: P): ValueAtPath<C, P> => {
      const node = getAtPath(config, path);
      const resolved = isNestedConfig(node)
        ? resolveSubtreeSync(node, path, env)
        : resolveEntrySync(buildEntry(node, path, env), env);
      return resolved as ValueAtPath<C, P>;
    };

    const resolve = async <P extends Paths<C> & string>(
      path: P,
      fetcher: Fetcher,
    ): Promise<ValueAtPath<C, P>> => {
      const node = getAtPath(config, path);
      const resolved = isNestedConfig(node)
        ? await resolveSubtreeAsync(node, path, env, fetcher)
        : await resolveEntryAsync(buildEntry(node, path, env), env, fetcher);
      return resolved as ValueAtPath<C, P>;
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
