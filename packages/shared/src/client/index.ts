// @contract client/index v1
// @consumers the root barrel (../index); packages and apps import from "@moon-cleanup/shared" only
//
// Sub-barrel of the client contracts: ClientModule, FrameInfo, service registry keys and opaque service types, and the
// RoomHost surface (local Solo worker / remote server room).

export * from "./module";
export * from "./room-host";
