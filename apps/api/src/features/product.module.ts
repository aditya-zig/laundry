import { DynamicModule, Module } from '@nestjs/common';
import { BillingV2Module } from './billing-v2/billing-v2.module';
import { LogisticsV2Module } from './logistics-v2/logistics.module';
import { MediaModule } from './media/media.module';
import { SupportModule } from './support/support.module';
import { ReviewsModule } from './reviews/reviews.module';
import { JobsModule } from './jobs/jobs.module';
import { ConversationsModule } from './conversations-v2/conversations-v2.module';
import type { BillingService } from '../../../../modules/billing/src';
import type { LogisticsService } from '../../../../modules/logistics/src';
import type { MediaService } from '../../../../modules/media/src';
import type { SupportService } from '../../../../modules/support/src';
import type { ReviewsService } from '../../../../modules/reviews/src';
import type { JobsService } from '../../../../modules/jobs/src';
import type { ConversationsService } from '../../../../modules/conversations/src';

/** Coordinator-owned composition boundary. A missing integration is explicitly
 * unavailable; registering a route never selects a fake external provider. */
export interface ProductServices {
  billing?: () => BillingService | null;
  logistics?: () => LogisticsService | null;
  media?: () => MediaService | null;
  support?: () => SupportService | null;
  reviews?: () => ReviewsService | null;
  jobs?: () => JobsService | null;
  conversations?: () => ConversationsService | null;
}

@Module({})
export class ProductModule {
  static register(services: ProductServices): DynamicModule {
    return { module: ProductModule, imports: [
      BillingV2Module.register(services.billing ?? (() => null)),
      LogisticsV2Module.register(services.logistics ?? (() => null)),
      MediaModule.register(services.media ?? (() => null)),
      SupportModule.register(services.support ?? (() => null)),
      ReviewsModule.register(services.reviews ?? (() => null)),
      JobsModule.register(services.jobs ?? (() => null)),
      ConversationsModule.register(services.conversations ?? (() => null)),
    ] };
  }
}
