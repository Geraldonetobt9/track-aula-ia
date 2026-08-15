import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './services/supabase.service';
import { EncryptionService } from './services/encryption.service';
import { CacheService } from './services/cache.service';
import { DiscordLoggerService } from './services/discord-logger.service';

@Global()
@Module({
  providers: [SupabaseService, EncryptionService, CacheService, DiscordLoggerService],
  exports: [SupabaseService, EncryptionService, CacheService, DiscordLoggerService],
})
export class SharedModule {}
