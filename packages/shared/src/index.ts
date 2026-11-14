// @contract index v1
// @consumers every workspace package and app ("@moon-cleanup/shared"); deep imports are banned
//
// Root barrel of the contracts package: one sub-barrel per folder of docs/architecture/module-boundaries.md
// section 2. Versions: PROTOCOL_VERSION (protocol), SAVE_FORMAT_VERSION (save), GAME_DATA_SCHEMA_VERSION (config).

export * from "./ids";
export * from "./units";
export * from "./protocol";
export * from "./sim";
export * from "./world";
export * from "./events";
export * from "./client";
export * from "./ui";
export * from "./audio";
export * from "./render";
export * from "./config";
export * from "./api";
export * from "./save";
