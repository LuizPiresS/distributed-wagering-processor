import { SQSClient } from "@aws-sdk/client-sqs";
import { Provider } from "@nestjs/common";

export const SQS_CLIENT = Symbol("SQS_CLIENT");

export const sqsClientProvider: Provider = {
  provide: SQS_CLIENT,
  useFactory: () => {
    return new SQSClient({
      region: process.env.AWS_REGION || "us-east-1",
      endpoint:
        process.env.AWS_ENDPOINT_URL ||
        process.env.AWS_ENDPOINT ||
        "http://localhost:4566",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
      },
    });
  },
};

