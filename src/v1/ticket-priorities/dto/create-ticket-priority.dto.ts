import { IsString, IsOptional } from 'class-validator';

export class CreateTicketPriorityDto {
  // ... existing fields like name

  @IsString()
  @IsOptional()
  description?: string;
}
