// Repo-root ESLint entry. All rules live in packages/config/eslint (module boundaries + three.js ban-list):
// docs/architecture/module-boundaries.md section 1, ADR-0001, ADR-0003.
// Package scripts run `eslint .` inside their own folder; ESLint walks up and finds this file.
export { eslintConfig as default } from "@moon-cleanup/config/eslint";
