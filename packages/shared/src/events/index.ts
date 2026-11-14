// @contract events/index v1
// @consumers the root barrel (../index); packages and apps import from "@moon-cleanup/shared" only
//
// Sub-barrel of the event contracts: the typed event bus, the event catalog, the gameplay payloads and the Solo save events.

export * from "./catalog";
export * from "./gameplay";
export * from "./save";
