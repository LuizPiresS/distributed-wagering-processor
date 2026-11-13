import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AppModule } from "../../src/app.module";

describe("Health API (Integration)", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /health/live", () => {
    it("should return 200 OK with status alive", async () => {
      const res = await fetch(`${baseUrl}/health/live`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.status).toBe("alive");
      expect(data.timestamp).toBeDefined();
    });
  });

  describe("GET /health/ready", () => {
    it("should return 200 OK when both PostgreSQL and SQS are healthy", async () => {
      const res = await fetch(`${baseUrl}/health/ready`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.status).toBe("ready");
      expect(data.checks.database).toBe("healthy");
      expect(data.checks.sqs).toBe("healthy");
    });
  });
});

