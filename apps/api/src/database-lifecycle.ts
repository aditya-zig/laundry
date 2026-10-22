import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { closePool } from "../../../modules/shared/src/db";

@Injectable()
export class DatabaseLifecycle implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> { await closePool(); }
}
