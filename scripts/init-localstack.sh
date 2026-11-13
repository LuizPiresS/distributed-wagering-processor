#!/bin/bash
set -e

echo "Initializing LocalStack SQS FIFO queues..."

# Define AWS CLI endpoint and region for LocalStack
ENDPOINT_URL="http://localhost:4566"
REGION="us-east-1"

# 1. Create Dead Letter Queue (DLQ FIFO)
echo "Creating wager-transactions-dlq.fifo..."
awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false \
  --region "$REGION" || true

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$ENDPOINT_URL/000000000000/wager-transactions-dlq.fifo" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text \
  --region "$REGION")

echo "DLQ ARN: $DLQ_ARN"

# 2. Create Redrive Policy JSON
REDRIVE_POLICY="{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"3\"}"

# 3. Create Main Queue (FIFO) with Redrive Policy
echo "Creating wager-transactions.fifo with redrive policy..."
awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes "FifoQueue=true,ContentBasedDeduplication=false,RedrivePolicy='$REDRIVE_POLICY'" \
  --region "$REGION" || true

echo "LocalStack SQS FIFO initialization complete."

