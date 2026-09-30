/**
 * Shared AWS credential resolution for Bedrock + AgentCore.
 *
 * Uses the standard Node provider chain: env vars (AWS_ACCESS_KEY_ID/…),
 * AWS_PROFILE / SSO, web identity, ECS/EC2/Lambda role. The chain memoizes and
 * refreshes temporary credentials, so one instance is shared per process.
 */

import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

let provider = null;

export async function getAwsCredentials() {
  provider ??= fromNodeProviderChain();
  const { accessKeyId, secretAccessKey, sessionToken } = await provider();
  return { accessKeyId, secretAccessKey, sessionToken };
}
