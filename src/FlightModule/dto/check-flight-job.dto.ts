import { DbRegion } from '@prisma/client';

export interface CheckFlightJobDto {
  flightId: number;
  region: DbRegion;
}
