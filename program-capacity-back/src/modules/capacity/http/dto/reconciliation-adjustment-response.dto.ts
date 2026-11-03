import { ApiProperty } from "@nestjs/swagger";
import { ReconciliationAdjustmentAction } from "@/modules/capacity/capacity.enums";

export class ReconciliationAdjustmentResponseDto {
  @ApiProperty({ example: "INV-2026-00042" })
  invoiceId: string;

  @ApiProperty({ enum: ReconciliationAdjustmentAction })
  action: ReconciliationAdjustmentAction;

  @ApiProperty({ example: "135150.00" })
  outstandingProgramAmountBefore: string;

  @ApiProperty({ example: "135400.00" })
  outstandingProgramAmountAfter: string;
}
