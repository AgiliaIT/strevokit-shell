import lit from "eslint-plugin-lit";
import litA11y from "eslint-plugin-lit-a11y";
import tseslint from "typescript-eslint";

/** Every enabled lit-a11y rule from the recommended preset, raised to an error. */
const litA11yRules = Object.fromEntries(
  Object.entries(litA11y.configs.recommended.rules).map(([name, setting]) => {
    const level = Array.isArray(setting) ? setting[0] : setting;
    if (level === "off" || level === 0) return [name, "off"];
    return [name, Array.isArray(setting) ? ["error", ...setting.slice(1)] : "error"];
  }),
);

export default tseslint.config(
  {
    ignores: ["dist/", "build/", "coverage/", "etc/", "node_modules/", "*.min.js", "docs/examples/"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    plugins: { lit, "lit-a11y": litA11y },
    rules: {
      ...lit.configs["flat/recommended"].rules,
      ...litA11yRules,
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-console": "error",
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "hack", "xxx"], location: "anywhere" }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@strevokit/meeting-sdk/*"],
              message: "Import the meeting SDK from its root entry only.",
            },
          ],
        },
      ],
    },
  },
);
