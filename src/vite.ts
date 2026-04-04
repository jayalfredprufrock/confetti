import type { Plugin } from "vite";

export const confetti = (resolvedConfig: Record<string, unknown>): Plugin => {
  const virtualModuleId = "virtual:confetti";
  const resolvedVirtualModuleId = `\0${virtualModuleId}`;

  return {
    name: "confetti", // required, will show up in warnings and errors
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return `export const config = ${JSON.stringify(resolvedConfig)}; export default { config };`;
      }
    },
  };
};
