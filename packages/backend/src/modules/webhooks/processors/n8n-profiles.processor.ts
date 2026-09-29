import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../../shared/services/supabase.service';

@Injectable()
export class N8nProfilesProcessor {
  private readonly logger = new Logger(N8nProfilesProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  async process(
    body: any,
    _authToken: string | null,
  ): Promise<{ status: number; body: any }> {
    const payload = body;

    this.logger.log(
      'Webhook n8n profiles received: ' +
        JSON.stringify(payload).substring(0, 500),
    );

    const { user_id, email, ...updateFields } = payload;

    if (!user_id && !email) {
      return {
        status: 400,
        body: { error: 'user_id or email is required' },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    // Build the update data - allow common profile fields
    const allowedFields = [
      'name',
      'plan',
      'cpf',
      'avatar_url',
      'active',
      'subscription_start',
      'subscription_end',
    ];

    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in updateFields) {
        updateData[field] = updateFields[field];
      }
    }

    // Also allow email updates
    if (email && user_id) {
      updateData['email'] = email;
    }

    updateData['updated_at'] = new Date().toISOString();

    if (Object.keys(updateData).length <= 1) {
      return {
        status: 400,
        body: { error: 'No valid fields to update' },
      };
    }

    // Find the profile by user_id or email
    let query = supabaseAdmin.from('profiles').update(updateData);

    if (user_id) {
      query = query.eq('user_id', user_id);
    } else {
      query = query.eq('email', email);
    }

    const { data, error } = await query.select();

    if (error) {
      this.logger.error('Error updating profile:', error);
      return { status: 500, body: { error: error.message } };
    }

    if (!data || data.length === 0) {
      return { status: 404, body: { error: 'Profile not found' } };
    }

    // Send welcome email (fire-and-forget)
    const profileEmail = data[0].email || email;
    const profileName = data[0].name || updateFields.name || 'Usuário';
    this.logger.log(
      `[webhook-n8n-profiles] Triggering welcome email for: ${profileEmail} (name: ${profileName})`,
    );

    if (profileEmail) {
      const supabaseUrl = this.config.get<string>('SUPABASE_URL');
      const supabaseAnonKey = this.config.get<string>('SUPABASE_ANON_KEY');

      if (supabaseUrl && supabaseAnonKey) {
        try {
          const emailRes = await fetch(
            `${supabaseUrl}/functions/v1/send-welcome-email`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${supabaseAnonKey}`,
              },
              body: JSON.stringify({
                email: profileEmail,
                name: profileName,
              }),
            },
          );
          const emailBody = await emailRes.text();
          this.logger.log(
            `[webhook-n8n-profiles] Welcome email result: ${emailRes.status} ${emailBody}`,
          );
        } catch (err: any) {
          this.logger.error(
            '[webhook-n8n-profiles] Welcome email error:',
            err.message,
          );
        }
      } else {
        this.logger.warn(
          '[webhook-n8n-profiles] No SUPABASE_ANON_KEY configured, skipping welcome email',
        );
      }
    } else {
      this.logger.warn(
        '[webhook-n8n-profiles] No email found for profile, skipping welcome email',
      );
    }

    return {
      status: 200,
      body: { success: true, profile: data[0] },
    };
  }
}
