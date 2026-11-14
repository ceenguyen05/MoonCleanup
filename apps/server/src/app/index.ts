// Server entry (built by build.config.mjs to dist/index.js). Boots the composition root and owns process-level
// failure handling: invalid environment -> readable message, exit 1 (no values printed); fatal runtime errors are
// logged and exit 1 so the platform restarts the service.

import { EnvValidationError, loadServerEnv, type ServerEnv } from "../ops";
import { startServer } from "./server";
import { installShutdown } from "./shutdown";

async function main(): Promise<void> {
  let env: ServerEnv;
  try {
    // TRANSPORT (auto | uws | ws) is part of the validated environment (ServerEnv.transport).
    env = loadServerEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const app = await startServer(env);
  installShutdown(app);

  const fatal = (kind: string) => (error: unknown) => {
    app.logger.fatal({ err: error, kind }, "fatal process error");
    process.exit(1);
  };
  process.on("uncaughtException", fatal("uncaughtException"));
  process.on("unhandledRejection", fatal("unhandledRejection"));
}

main().catch((error: unknown) => {
  console.error("moon-cleanup-server failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
