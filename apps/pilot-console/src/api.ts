import { ApiError as ApiFailure, createClient, type WandaryClient } from "@wandary/api-client";
import type {
  PilotAction,
  PilotBooking,
  PilotConfig,
  PilotLocation,
  PilotLocationReport,
  PilotOrder,
  PilotRider,
  PilotSlot,
} from "@wandary/contracts";

export { ApiFailure };
export type { PilotAction, PilotBooking, PilotConfig, PilotLocation, PilotLocationReport, PilotOrder, PilotRider, PilotSlot };

export type Role = "customer" | "operator" | "rider";

/** Thin wrapper over the shared SDK. Every wire call goes through
 * @wandary/api-client so the console cannot drift from the contract. */
export class PilotApi {
  private readonly client: WandaryClient;
  token?: string;
  user?: { id: string; role: string; name: string };

  constructor(baseUrl: string) {
    this.client = createClient({ baseUrl, getToken: () => this.token });
  }

  async demoLogin(role: Role): Promise<void> {
    const session = await this.client.demoAuth(role);
    this.token = session.token;
    this.user = session.user;
  }

  config(): Promise<PilotConfig> {
    return this.client.pilotConfig();
  }

  listOrders(): Promise<PilotOrder[]> {
    return this.client.pilotListOrders();
  }

  order(id: string): Promise<PilotOrder> {
    return this.client.pilotOrder(id);
  }

  createOrder(input: PilotBooking, idempotencyKey?: string): Promise<PilotOrder> {
    return this.client.pilotCreateOrder(input, { idempotencyKey });
  }

  action(id: string, action: PilotAction, idempotencyKey?: string): Promise<PilotOrder> {
    return this.client.pilotAction(id, action, { idempotencyKey });
  }

  setSlotCapacity(slotId: string, capacity: number, idempotencyKey?: string): Promise<PilotSlot> {
    return this.client.pilotSetSlotCapacity(slotId, capacity, { idempotencyKey });
  }

  reportLocation(id: string, report: PilotLocationReport, idempotencyKey?: string): Promise<PilotLocation> {
    return this.client.pilotReportLocation(id, report, { idempotencyKey });
  }

  /** No report yet is a normal state, not a failure. */
  async location(id: string): Promise<PilotLocation | null> {
    try {
      return await this.client.pilotLocation(id);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) return null;
      throw error;
    }
  }

  async riders(): Promise<PilotRider[]> {
    try {
      return await this.client.pilotRiders();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) return [];
      throw error;
    }
  }
}
