import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  AuthenticatedProvider,
  NoopProviderIdentityService,
  ProviderIdentityPort,
} from "../../application/ports/provider-identity.port";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

declare global {
  namespace Express {
    interface Request {
      provider?: AuthenticatedProvider;
    }
  }
}

@Injectable()
export class ProviderAuthGuard implements CanActivate {
  private readonly logger = new Logger(ProviderAuthGuard.name);
  private readonly identityPort: ProviderIdentityPort;

  constructor(
    private readonly reflector: Reflector,
    @Optional() identityPort?: ProviderIdentityPort
  ) {
    this.identityPort = identityPort || new NoopProviderIdentityService();
  }

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers["authorization"];

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      try {
        const provider = await this.identityPort.authenticate(token);
        request.provider = provider;
        return true;
      } catch (err) {
        this.logger.warn(`Provider authentication failed: ${(err as Error).message}`);
        return false;
      }
    }

    // No-Op / Development fallback mode (as documented in README Section 2 & ARCHITECTURE.md)
    request.provider = {
      providerId: request.body?.providerId || "development-provider",
      clientId: "dev-client-id",
      scopes: ["wagering:all"],
      authorizedGames: ["*"],
    };

    return true;
  }
}
