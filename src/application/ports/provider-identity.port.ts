export interface AuthenticatedProvider {
  readonly providerId: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly authorizedGames: readonly string[];
}

export abstract class ProviderIdentityPort {
  public abstract authenticate(token: string): Promise<AuthenticatedProvider>;
}

export class NoopProviderIdentityService implements ProviderIdentityPort {
  public async authenticate(_token: string): Promise<AuthenticatedProvider> {
    return {
      providerId: "trusted-local-provider",
      clientId: "client-local-dev",
      scopes: ["wagering:read", "wagering:write"],
      authorizedGames: ["*"],
    };
  }
}
