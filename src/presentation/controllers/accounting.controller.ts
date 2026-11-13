import { Controller, Get, HttpCode, HttpStatus, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { TrialBalanceResultDto } from "../../application/dto/trial-balance.dto";
import { GetTrialBalanceUseCase } from "../../application/use-cases/get-trial-balance.use-case";
import { Public } from "../decorators/public.decorator";

@ApiTags("Accounting & Double-Entry")
@Public()
@Controller("accounting")
export class AccountingController {
  constructor(private readonly getTrialBalanceUseCase: GetTrialBalanceUseCase) {}

  @Get("trial-balance")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Auditar Balancete de Verificação de Partidas Dobradas (Trial Balance)",
    description:
      "Calcula em tempo real a equação contábil de partidas dobradas entre carteiras de jogadores e contas da casa (HOLDING, EXPENSE, ESCROW). Comprova matematicamente que a soma de todos os débitos é rigorosamente idêntica à soma de todos os créditos (discrepancy: 0.00).",
  })
  @ApiQuery({
    name: "currency",
    required: false,
    description: "Moeda a ser auditada (padrão: BRL)",
    example: "BRL",
  })
  @ApiResponse({
    status: 200,
    description: "Balancete de verificação calculado com sucesso.",
    type: TrialBalanceResultDto,
  })
  public async getTrialBalance(
    @Query("currency") currency?: string,
  ): Promise<TrialBalanceResultDto> {
    return await this.getTrialBalanceUseCase.execute(currency);
  }
}
