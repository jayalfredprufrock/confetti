import { CONFETTI, DATA, DEFAULT, ENV_VAR } from "./symbols";
import type { Confetti, ConfigFlatMapContext, ConfigVal, ConfigValPerEnv, Obj } from "./types";

export const isObj = (val: unknown): val is Obj => {
  return val !== null && typeof val === "object" && !Array.isArray(val);
};

export const isConfigValPerEnv = (val: unknown): val is ConfigValPerEnv => {
  return isObj(val) && (DEFAULT in val || DATA in val || ENV_VAR in val);
};

export const isConfetti = (val: unknown): val is Confetti<any> => {
  return typeof val === "function" && Object.hasOwn(val, CONFETTI);
};

export const configFlatMap = <T>(
  env: string,
  obj: Obj,
  map: (context: ConfigFlatMapContext) => T | T[],
  _currentPath = "",
): T[] => {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = `${_currentPath}${key}`;

    if (isObj(value)) {
      if (isConfigValPerEnv(value)) {
        let unresolvedValue: ConfigVal | undefined;

        // first resolve environment variable if it exists
        if (value[ENV_VAR] && process.env[value[ENV_VAR]] !== undefined) {
          try {
            unresolvedValue = JSON.parse(process.env[value[ENV_VAR]]!);
          } catch {
            unresolvedValue = process.env[value[ENV_VAR]];
          }
        }
        // second resolve any explicit environment value
        else if (value[env] !== undefined) {
          unresolvedValue = value[env];
        }
        // finally look for a default value
        else if (value[DEFAULT] !== undefined) {
          unresolvedValue = value[DEFAULT];
        }

        if (unresolvedValue === undefined) {
          throw new Error(`Unable to find '${env}' config value at '${path}`);
        }

        return map({ path, unresolvedValue, envVar: value[ENV_VAR], data: value[DATA] });
      }

      return configFlatMap(env, value, map, `${path}.`);
    }

    return map({ path, unresolvedValue: value as ConfigVal });
  });
};

export const setAtPath = (obj: Obj, path: string, value: unknown) => {
  const segments = path.split(".");

  let objAtSeg: any = obj;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] ?? "";
    if (segments.length === i + 1) {
      objAtSeg[segment] = value;
    } else {
      if (!isObj(objAtSeg[segment])) {
        objAtSeg[segment] = {};
      }
      objAtSeg = objAtSeg[segment];
    }
  }
};
