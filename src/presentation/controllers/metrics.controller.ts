import { Controller, Get, Headers, Res } from "@nestjs/common";
import type { Response } from "express";
import { MetricsService } from "../../infrastructure/observability/metrics.service";
import { Public } from "../decorators/public.decorator";

@Public()
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  public getMetrics(
    @Headers("accept") accept: string | undefined,
    @Res() res: Response
  ): void {
    if (accept && accept.includes("application/json")) {
      res.setHeader("Content-Type", "application/json");
      res.status(200).json(this.metricsService.getSnapshot());
      return;
    }

    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.status(200).send(this.metricsService.toPrometheusText());
  }
}
