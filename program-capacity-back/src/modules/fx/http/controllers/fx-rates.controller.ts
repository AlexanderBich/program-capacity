import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FxRateResponseDto } from "@/modules/fx/http/dto/fx-rate-response.dto";
import { ListFxRatesEndpointHandler } from "@/modules/fx/http/endpoints/list-fx-rates.endpoint-handler";

@ApiTags("fx-rates")
@ApiBearerAuth("JWT")
@Controller("fx-rates")
export class FxRatesController {
  constructor(private readonly listFxRatesEndpointHandler: ListFxRatesEndpointHandler) {}

  @Get()
  @ApiOperation({ summary: "Latest published FX rate per currency pair" })
  @ApiOkResponse({ type: FxRateResponseDto, isArray: true })
  list(): Promise<FxRateResponseDto[]> {
    return this.listFxRatesEndpointHandler.handle();
  }
}
