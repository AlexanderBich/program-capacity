import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import { Observable } from "rxjs";
import { ErrorResponseDto } from "@/common/dto/error-response.dto";
import { PageQueryDto } from "@/common/dto/page-query.dto";
import { UserRole } from "@/modules/auth/auth.enums";
import { AuthedUser } from "@/modules/auth/auth.types";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { Roles } from "@/modules/auth/decorators/roles.decorator";
import { CapacityLedgerEntryListResponseDto } from "@/modules/capacity/http/dto/capacity-ledger-entry-response.dto";
import { CreateProgramBodyDto } from "@/modules/capacity/http/dto/create-program-body.dto";
import { ProgramAvailabilityResponseDto } from "@/modules/capacity/http/dto/program-availability-response.dto";
import { ProgramReconciliationListResponseDto } from "@/modules/capacity/http/dto/program-reconciliation-response.dto";
import {
  ProgramListResponseDto,
  ProgramResponseDto,
} from "@/modules/capacity/http/dto/program-response.dto";
import { StreamAvailabilityQueryDto } from "@/modules/capacity/http/dto/stream-availability-query.dto";
import { CreateProgramEndpointHandler } from "@/modules/capacity/http/endpoints/create-program.endpoint-handler";
import { GetProgramAvailabilityEndpointHandler } from "@/modules/capacity/http/endpoints/get-program-availability.endpoint-handler";
import { GetProgramEndpointHandler } from "@/modules/capacity/http/endpoints/get-program.endpoint-handler";
import { ListLedgerEntriesEndpointHandler } from "@/modules/capacity/http/endpoints/list-ledger-entries.endpoint-handler";
import { ListProgramsEndpointHandler } from "@/modules/capacity/http/endpoints/list-programs.endpoint-handler";
import { ListReconciliationsEndpointHandler } from "@/modules/capacity/http/endpoints/list-reconciliations.endpoint-handler";
import { StreamAvailabilityEndpointHandler } from "@/modules/capacity/http/endpoints/stream-availability.endpoint-handler";

@ApiTags("programs")
@ApiBearerAuth("JWT")
@Controller("programs")
export class ProgramsController {
  constructor(
    private readonly listProgramsEndpointHandler: ListProgramsEndpointHandler,
    private readonly createProgramEndpointHandler: CreateProgramEndpointHandler,
    private readonly getProgramEndpointHandler: GetProgramEndpointHandler,
    private readonly getProgramAvailabilityEndpointHandler: GetProgramAvailabilityEndpointHandler,
    private readonly streamAvailabilityEndpointHandler: StreamAvailabilityEndpointHandler,
    private readonly listLedgerEntriesEndpointHandler: ListLedgerEntriesEndpointHandler,
    private readonly listReconciliationsEndpointHandler: ListReconciliationsEndpointHandler,
  ) {}

  @Get()
  @ApiOperation({ summary: "List programs with their current availability" })
  @ApiOkResponse({ type: ProgramListResponseDto })
  list(@Query() query: PageQueryDto): Promise<ProgramListResponseDto> {
    return this.listProgramsEndpointHandler.handle(query);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Create a program" })
  @ApiCreatedResponse({ type: ProgramResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  create(
    @Body() body: CreateProgramBodyDto,
    @CurrentUser() user: AuthedUser,
  ): Promise<ProgramResponseDto> {
    return this.createProgramEndpointHandler.handle(body, user.email);
  }

  @Sse("availability/stream")
  @ApiOperation({
    summary: "Live availability (Server-Sent Events)",
    description:
      "Sends the current state of each program, then every change. `availability` events carry a " +
      "ProgramAvailabilityResponseDto; order them by `version` and ignore older ones. `heartbeat` " +
      "events keep the connection alive. The stream ends when the access token expires: reconnect " +
      "with a fresh one. Native EventSource cannot set headers, so use a fetch-based SSE client. " +
      "A user may hold a limited number of open streams: beyond it this answers 429.",
  })
  @ApiProduces("text/event-stream")
  stream(
    @Query() query: StreamAvailabilityQueryDto,
    @CurrentUser() user: AuthedUser,
  ): Observable<MessageEvent> {
    return this.streamAvailabilityEndpointHandler.handle(query, user);
  }

  @Get(":programId")
  @ApiOperation({ summary: "Get a program with its current availability" })
  @ApiOkResponse({ type: ProgramResponseDto })
  get(@Param("programId", ParseUUIDPipe) programId: string): Promise<ProgramResponseDto> {
    return this.getProgramEndpointHandler.handle(programId);
  }

  @Get(":programId/availability")
  @ApiOperation({ summary: "Current availability of a program" })
  @ApiOkResponse({ type: ProgramAvailabilityResponseDto })
  getAvailability(
    @Param("programId", ParseUUIDPipe) programId: string,
  ): Promise<ProgramAvailabilityResponseDto> {
    return this.getProgramAvailabilityEndpointHandler.handle(programId);
  }

  @Get(":programId/ledger-entries")
  @ApiOperation({ summary: "Audit trail of every capacity change, newest first" })
  @ApiOkResponse({ type: CapacityLedgerEntryListResponseDto })
  listLedgerEntries(
    @Param("programId", ParseUUIDPipe) programId: string,
    @Query() query: PageQueryDto,
  ): Promise<CapacityLedgerEntryListResponseDto> {
    return this.listLedgerEntriesEndpointHandler.handle(programId, query);
  }

  @Get(":programId/reconciliations")
  @ApiOperation({ summary: "Applied treasury reconciliations, newest first" })
  @ApiOkResponse({ type: ProgramReconciliationListResponseDto })
  listReconciliations(
    @Param("programId", ParseUUIDPipe) programId: string,
    @Query() query: PageQueryDto,
  ): Promise<ProgramReconciliationListResponseDto> {
    return this.listReconciliationsEndpointHandler.handle(programId, query);
  }
}
