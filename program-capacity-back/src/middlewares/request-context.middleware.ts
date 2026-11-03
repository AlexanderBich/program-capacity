import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { requestMetadataContext } from "@/common/contexts/request-metadata.context";

export const requestContextMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const incomingRequestId = request.header("x-request-id");
  const requestId =
    incomingRequestId && /^[\w-]{8,64}$/.test(incomingRequestId) ? incomingRequestId : randomUUID();
  response.setHeader("x-request-id", requestId);

  requestMetadataContext.run(
    new Map([
      ["requestId", requestId],
      ["method", request.method],
      ["path", request.path],
    ]),
    next,
  );
};
