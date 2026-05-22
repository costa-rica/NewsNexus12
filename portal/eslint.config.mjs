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
      // Tracked for cleanup in docs/20260522_PLAN_PORTAL_LINT_V03.md.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    files: ["src/components/tables/Table*.tsx"],
    rules: {
      // TanStack `useReactTable` returns mutable refs that React Compiler cannot prove pure.
      // Decision documented in docs/20260522_PLAN_PORTAL_LINT_V03.md.
      "react-hooks/incompatible-library": "off",
    },
  },
];

export default eslintConfig;
