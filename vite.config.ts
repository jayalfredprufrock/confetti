import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
  pack: {
    dts: true,
    exports: {
      devExports: true,
    },
    format: ["esm", "cjs"],
    sourcemap: true,
    entry: [
      "src/index.ts",
      {
        vite: "src/vite.ts",
      },
    ],
  },
});
