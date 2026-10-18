import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Build and test output. ESLint does not read .gitignore.
  { ignores: ["**/out/", "**/test-results/", "**/playwright-report/"] },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    // This config file is plain JS and sits outside every tsconfig.
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
