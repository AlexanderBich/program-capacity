import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class LoginBodyDto {
  @ApiProperty({ example: "operator@capacity.local" })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ example: "capacity-demo-password" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}
