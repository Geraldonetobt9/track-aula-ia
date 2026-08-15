import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isOperatorEmail } from '../../shared/constants/feature-allowlist';

/**
 * Restricts a route to the operator allowlist.
 *
 * Must be chained after AuthGuard, which is what puts `user` on the request —
 * the e-mail read here comes from `auth.getUser(token)`, not from anything the
 * client sent.
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException('User not authenticated');
    if (!isOperatorEmail(user.email)) {
      throw new ForbiddenException('Feature not available for this account');
    }
    return true;
  }
}
