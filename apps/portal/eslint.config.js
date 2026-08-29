import { config } from "@repo/eslint-config/react-internal";

export default [
  ...config,
  {
    ignores: ["build/**", ".react-router/**", "public/**"],
  },
  {
    files: ["app/providers.tsx"],
    rules: {
      "turbo/no-undeclared-env-vars": "off",
    },
  },
];
