import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // Kept as errors to prevent React Compiler cleanup regressions.
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "react-hooks/immutability": "error",
    },
  },
  {
    files: ["src/components/tables/Table*.tsx"],
    rules: {
      // TanStack `useReactTable` returns mutable refs that React Compiler cannot prove pure.
      // Keep this scoped exception so the rule remains active outside table components.
      "react-hooks/incompatible-library": "off",
    },
  },
];

export default eslintConfig;
