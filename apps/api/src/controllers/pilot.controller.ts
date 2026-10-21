import { Controller, Get, Post, Put, Body, Param, Req, Headers, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { pilotBookingSchema, pilotActionSchema, pilotLocationReportSchema } from "@wandary/contracts";
import { pilotAction } from "../../../../modules/pilot/src/actions";
import { reportPilotLocation, getPilotLocation } from "../../../../modules/pilot/src/location";
import type { Actor } from "../../../../modules/shared/src/auth";
import { AuthGuard } from "../guards/auth.guard";
import { getPool } from "../../../../modules/shared/src/db";
import { pilotConfig, createPilotOrder, getPilotOrder, listPilotOrders, setPilotCapacity, listPilotRiders } from "../../../../modules/pilot/src/pilot";

@Controller("v1/pilot")
@UseGuards(AuthGuard)
export class PilotController {
  @Get("config")
  config() { return pilotConfig(getPool()); }

  @Get("riders")
  riders(@Req() req: { actor: Actor }) { return listPilotRiders(getPool(), req.actor); }

  @Post("orders")
  book(@Req() req: { actor: Actor }, @Body() body: unknown, @Headers("idempotency-key") key: string) {
    return createPilotOrder(getPool(), req.actor, pilotBookingSchema.parse(body), z.string().uuid().parse(key));
  }
  @Get("orders")
  list(@Req() req: { actor: Actor }) { return listPilotOrders(getPool(), req.actor); }
  @Get("orders/:id")
  order(@Req() req: { actor: Actor }, @Param("id") id: string) { return getPilotOrder(getPool(), req.actor, z.string().uuid().parse(id)); }
  @Post("orders/:id/actions")
  action(@Req() req: { actor: Actor }, @Param("id") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string) {
    return pilotAction(getPool(), req.actor, z.string().uuid().parse(id), pilotActionSchema.parse(body), z.string().uuid().parse(key));
  }
  @Post("orders/:id/location")
  location(
    @Req() req: { actor: Actor }, @Param("id") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string,
  ) {
    const report = pilotLocationReportSchema.parse(body);
    return reportPilotLocation(getPool(), req.actor, z.string().uuid().parse(id), report, z.string().uuid().parse(key));
  }
  @Get("orders/:id/location")
  readLocation(@Req() req: { actor: Actor }, @Param("id") id: string) {
    return getPilotLocation(getPool(), req.actor, z.string().uuid().parse(id));
  }
  @Put("slots/:id")
  capacity(@Req() req: { actor: Actor }, @Param("id") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string) {
    const input = z.object({ capacity: z.number().int().min(0).max(100) }).strict().parse(body);
    return setPilotCapacity(getPool(), req.actor, z.string().uuid().parse(id), input.capacity, z.string().uuid().parse(key));
  }
}
