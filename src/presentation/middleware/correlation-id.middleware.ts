import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

export const CORRELATION_ID_HEADER = "X-Correlation-ID";

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  public use(req: Request, res: Response, next: NextFunction): void {
    const rawHeader =
      req.header(CORRELATION_ID_HEADER) ||
      req.header(CORRELATION_ID_HEADER.toLowerCase());

    const correlationId = rawHeader && rawHeader.trim() ? rawHeader.trim() : uuidv4();

    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    next();
  }
}
