import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { META_API_VERSION } from '../../shared/constants/meta-api';

const FB_API_VERSION = META_API_VERSION;
const GRAPH = `https://graph.facebook.com/${FB_API_VERSION}`;

export interface InspectedToken {
  facebookUserId: string;
  facebookUserName: string;
  /** null quando o token nao declara expiracao (token de System User). */
  expiresAt: Date | null;
  scopes: string[];
}

/**
 * Substitui o FacebookOAuthService.
 *
 * O fluxo antigo exigia um app do Facebook (APP_ID, APP_SECRET, REDIRECT_URI),
 * dialogo de autorizacao, troca de code por token curto, troca por token longo
 * e state assinado contra CSRF. Agora o cliente cola o token e nada disso
 * precisa existir — inclusive as tres variaveis de ambiente, que eram
 * getOrThrow e derrubavam a aplicacao inteira quando faltavam.
 */
@Injectable()
export class FacebookTokenService {
  private readonly logger = new Logger(FacebookTokenService.name);

  async inspect(accessToken: string): Promise<InspectedToken> {
    const token = accessToken?.trim();

    if (!token) throw new BadRequestException('Cole o token de acesso do Meta.');
    if (token.length < 50) {
      throw new BadRequestException('Esse token parece incompleto. Copie o valor inteiro.');
    }

    const me = await this.graph<{ id: string; name: string }>('me', token, { fields: 'id,name' });

    // debug_token pode ser recusado dependendo do tipo de token. Nao e fatal:
    // sem ele so ficamos sem escopos e validade, e o /me ja provou que funciona.
    const debug = await this.graph<{
      data?: { scopes?: string[]; expires_at?: number };
    }>('debug_token', token, { input_token: token }).catch(() => ({ data: undefined }));

    const info = debug.data ?? {};

    return {
      facebookUserId: me.id,
      facebookUserName: me.name,
      // expires_at = 0 significa token sem expiracao.
      expiresAt: info.expires_at ? new Date(info.expires_at * 1000) : null,
      scopes: info.scopes ?? [],
    };
  }

  private async graph<T>(
    path: string,
    token: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(`${GRAPH}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    // Token no header, nao na query: query string entra em log de servidor e
    // em historico de proxy.
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body: any = await response.json();

    if (!response.ok) {
      const code = body?.error?.code;
      const message = body?.error?.message ?? 'Erro desconhecido na API do Meta';

      if (code === 190) {
        throw new BadRequestException('Token invalido ou expirado. Gere um novo no Meta.');
      }
      if (code === 200 || code === 10) {
        throw new BadRequestException(`O token nao tem a permissao necessaria: ${message}`);
      }

      this.logger.warn(`Graph ${path} falhou: ${message}`);
      throw new BadRequestException(`Meta: ${message}`);
    }

    return body as T;
  }
}
