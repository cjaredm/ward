import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // NEXT_DIST_DIR=.next-verify npm run build — same build output, different dir.
      ".next-verify/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Vendored maplibre worker bundle, copied in by scripts/copy-maplibre-worker.mjs.
      "public/**",
    ],
  },
];

export default eslintConfig;
