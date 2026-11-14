// TEST-ONLY workarounds for two boot blockers (M0-W1-T04 report). Remove when the dependency fixes land.
//
// 1. uWebSockets.js v20.71.0 ships an ESM_wrapper.mjs that imports `./index.js`, a file the tag does not contain
//    (v20.52-v20.70 import `./uws.js`). Every ESM import of the package fails with ERR_MODULE_NOT_FOUND.
// 2. @colyseus/uwebsockets-transport 0.18.5 does `import("uwebsockets-express")` at module load and rejects an
//    internal Deferred nobody awaits when that optional peer is absent: an unhandled rejection that terminates Node.
//
// This synchronous resolve hook redirects (1) and resolves (2) to an empty module so the Colyseus integration tests
// run while the fixes are pending. Production code must not use it; `uws-boot.test.ts` deliberately does not.

import { registerHooks } from "node:module";

const EMPTY_MODULE = "data:text/javascript,export default undefined;";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./index.js" && context.parentURL?.endsWith("/uWebSockets.js/ESM_wrapper.mjs")) {
      return nextResolve("./uws.js", context);
    }
    if (specifier === "uwebsockets-express") {
      return { url: EMPTY_MODULE, format: "module", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
