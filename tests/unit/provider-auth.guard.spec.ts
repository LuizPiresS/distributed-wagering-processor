import { describe, expect, it } from "bun:test";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  AuthenticatedProvider,
  NoopProviderIdentityService,
  ProviderIdentityPort,
} from "../../src/application/ports/provider-identity.port";
import { ProviderAuthGuard } from "../../src/presentation/guards/provider-auth.guard";

class MockExecutionContext {
  private readonly headers: Record<string, string>;
  public readonly request: any;

  constructor(headers: Record<string, string> = {}, body: any = {}) {
    this.headers = headers;
    this.request = {
      headers: this.headers,
      body,
    };
  }

  public switchToHttp() {
    return {
      getRequest: () => this.request,
    };
  }

  public getHandler() {
    return {};
  }

  public getClass() {
    return {};
  }
}

describe("ProviderAuthGuard (README Seção 2)", () => {
  it("deve permitir requisições públicas marcadas com @Public()", async () => {
    const reflector = {
      getAllAndOverride: (_key: string, _targets: any[]) => true,
    } as unknown as Reflector;

    const guard = new ProviderAuthGuard(reflector);
    const context = new MockExecutionContext() as unknown as ExecutionContext;

    const canActivate = await guard.canActivate(context);
    expect(canActivate).toBe(true);
  });

  it("deve operar em modo no-op quando nenhum token for fornecido", async () => {
    const reflector = {
      getAllAndOverride: (_key: string, _targets: any[]) => false,
    } as unknown as Reflector;

    const guard = new ProviderAuthGuard(reflector);
    const mockContext = new MockExecutionContext({}, { providerId: "custom-provider" });

    const canActivate = await guard.canActivate(mockContext as unknown as ExecutionContext);
    expect(canActivate).toBe(true);
    expect(mockContext.request.provider).toBeDefined();
    expect(mockContext.request.provider.providerId).toBe("custom-provider");
  });

  it("deve delegar a autenticação para ProviderIdentityPort quando Bearer token for enviado", async () => {
    const reflector = {
      getAllAndOverride: (_key: string, _targets: any[]) => false,
    } as unknown as Reflector;

    class CustomIdentityService implements ProviderIdentityPort {
      public async authenticate(token: string): Promise<AuthenticatedProvider> {
        if (token === "valid-secret-token") {
          return {
            providerId: "pragmatic-play",
            clientId: "client-123",
            scopes: ["wagering:write"],
            authorizedGames: ["fortune-tiger"],
          };
        }
        throw new Error("Invalid token");
      }
    }

    const guard = new ProviderAuthGuard(reflector, new CustomIdentityService());

    // Token válido
    const validContext = new MockExecutionContext({
      authorization: "Bearer valid-secret-token",
    });
    const canActivateValid = await guard.canActivate(validContext as unknown as ExecutionContext);
    expect(canActivateValid).toBe(true);
    expect(validContext.request.provider.providerId).toBe("pragmatic-play");

    // Token inválido
    const invalidContext = new MockExecutionContext({
      authorization: "Bearer invalid-token",
    });
    const canActivateInvalid = await guard.canActivate(invalidContext as unknown as ExecutionContext);
    expect(canActivateInvalid).toBe(false);
  });
});
