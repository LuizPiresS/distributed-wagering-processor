import { GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";
import { EntityManager } from "@mikro-orm/postgresql";
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { SQS_CLIENT } from "../../infrastructure/messaging/sqs/sqs-client.provider";
import { Public } from "../decorators/public.decorator";

@Public()
@Controller("health")
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    @Inject(SQS_CLIENT)
    private readonly sqsClient: SQSClient,
  ) {}

  @Get("live")
  @HttpCode(HttpStatus.OK)
  public live() {
    return {
      status: "alive",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  public async ready(@Res() res: Response) {
    const checks: Record<string, string> = {
      database: "unknown",
      sqs: "unknown",
    };

    let allHealthy = true;

    // 1. Check PostgreSQL
    try {
      await this.em.getConnection().execute("SELECT 1;");
      checks.database = "healthy";
    } catch (dbError) {
      checks.database = `unhealthy: ${(dbError as Error).message}`;
      allHealthy = false;
    }

    // 2. Check SQS
    try {
      await this.sqsClient.send(
        new GetQueueUrlCommand({ QueueName: "wager-transactions.fifo" }),
      );
      checks.sqs = "healthy";
    } catch (sqsError) {
      checks.sqs = `unhealthy: ${(sqsError as Error).message}`;
      allHealthy = false;
    }

    if (allHealthy) {
      return res.status(HttpStatus.OK).json({
        status: "ready",
        checks,
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      status: "unhealthy",
      checks,
      timestamp: new Date().toISOString(),
    });
  }
}
