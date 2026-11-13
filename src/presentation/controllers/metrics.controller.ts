import { Controller, Get, Headers, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { MetricsService } from "../../infrastructure/observability/metrics.service";
import { Public } from "../decorators/public.decorator";

@ApiTags("Health & Observability")
@Public()
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({
    summary: "Exportar métricas em formato Prometheus / OpenMetrics ou JSON",
    description:
      "Exporta as 7 métricas obrigatórias de negócio e infraestrutura: status de transações, duplicatas detectadas, retries de outbox/sqs, mensagens em DLQ, conflitos de lock, outbox lag e percentis de latência.",
  })
  @ApiResponse({ status: 200, description: "Métricas geradas com sucesso." })
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
