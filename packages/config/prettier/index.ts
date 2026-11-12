// Shared Prettier options. Indent, EOL and final newline are also set by the repo-root .editorconfig; the values
// here repeat only what Prettier does not read from it (printWidth mirrors max_line_length = 120).
// The repo-root prettier.config.js re-exports this object (a default export is required there, not here).
import type { Config } from "prettier";

export const prettierConfig: Config = {
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  arrowParens: "always",
  bracketSpacing: true,
  endOfLine: "lf",
};
