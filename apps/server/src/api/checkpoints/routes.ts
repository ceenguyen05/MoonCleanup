// Solo checkpoint routes (M1-W5-T07). `head` is plain JSON. `upload` and `download` are binary: the route def spreads
// `API_ROUTES.checkpointUpload` (rawBodyMaxBytes, so the adapter opts into a raw body) and the handler reads `request.rawBody`
// (u16 LE metaLen | metadata JSON | MCCK package, see @moon-cleanup/protocol) and the download answers `binary`. Until the
// net adapter implements rawBody/binary the upload answers 400 and the download an empty body.
// See docs/agent-reports/M1-W5-T07-backend-data-engineer.md.

import { API_ROUTES, ContractIdSchema, type HttpResponse, type HttpRouteDef } from "@moon-cleanup/shared";
import { authed, notFound, type ApiContext } from "../http";
import { createCheckpointService, type CheckpointOptions } from "./service";

export function createCheckpointRoutes(ctx: ApiContext, options: CheckpointOptions = {}): HttpRouteDef[] {
  const service = createCheckpointService(ctx, options);
  const idOf = (value: string | undefined): string | undefined => {
    const parsed = ContractIdSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };

  const upload = authed(ctx, "checkpointUpload", async (request, playerId): Promise<HttpResponse> => {
    const id = idOf(request.params.id);
    if (id === undefined) return notFound();
    return service.upload(playerId, id, request, new Date(ctx.now()));
  });
  const head = authed(ctx, "saveHead", async (request, playerId): Promise<HttpResponse> => {
    const id = idOf(request.params.id);
    return id === undefined ? notFound() : service.head(playerId, id);
  });
  const download = authed(ctx, "saveDownload", async (request, playerId): Promise<HttpResponse> => {
    const id = idOf(request.params.id);
    return id === undefined ? notFound() : service.download(playerId, id, request.query);
  });

  return [
    { ...API_ROUTES.checkpointUpload, handle: upload },
    { ...API_ROUTES.saveHead, handle: head },
    { ...API_ROUTES.saveDownload, handle: download },
  ];
}
