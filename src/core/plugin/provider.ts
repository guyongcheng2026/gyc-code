import { AmazonBedrockPlugin } from "./provider/amazon-bedrock"
import { AnthropicPlugin } from "./provider/anthropic"
import { AzureCognitiveServicesPlugin, AzurePlugin } from "./provider/azure"
import { CloudflareAIGatewayPlugin } from "./provider/cloudflare-ai-gateway"
import { CloudflareWorkersAIPlugin } from "./provider/cloudflare-workers-ai"
import { DynamicProviderPlugin } from "./provider/dynamic"
import { GatewayPlugin } from "./provider/gateway"
import { GithubCopilotPlugin } from "./provider/github-copilot"
import { GitLabPlugin } from "./provider/gitlab"
import { GooglePlugin } from "./provider/google"
import { GoogleVertexAnthropicPlugin, GoogleVertexPlugin } from "./provider/google-vertex"
import { KiloPlugin } from "./provider/kilo"
import { LLMGatewayPlugin } from "./provider/llmgateway"
import { NvidiaPlugin } from "./provider/nvidia"
import { OpenAIPlugin } from "./provider/openai"
import { SnowflakeCortexPlugin } from "./provider/snowflake-cortex"
import { OpenAICompatiblePlugin } from "./provider/openai-compatible"
import { GyccodePlugin } from "./provider/gyccode"
import { OpenRouterPlugin } from "./provider/openrouter"
import { SapAICorePlugin } from "./provider/sap-ai-core"
import { VenicePlugin } from "./provider/venice"
import { ZenmuxPlugin } from "./provider/zenmux"
import type { PluginInternal } from "./internal"
import type { Scope } from "effect"

export const ProviderPlugins: PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>[] = [
  AmazonBedrockPlugin,
  AnthropicPlugin,
  AzureCognitiveServicesPlugin,
  AzurePlugin,
  CloudflareAIGatewayPlugin,
  CloudflareWorkersAIPlugin,
  GatewayPlugin,
  GithubCopilotPlugin,
  GitLabPlugin,
  GooglePlugin,
  GoogleVertexAnthropicPlugin,
  GoogleVertexPlugin,
  KiloPlugin,
  LLMGatewayPlugin,
  NvidiaPlugin,
  GyccodePlugin,
  SnowflakeCortexPlugin,
  OpenAICompatiblePlugin,
  OpenAIPlugin,
  OpenRouterPlugin,
  SapAICorePlugin,
  VenicePlugin,
  ZenmuxPlugin,
  DynamicProviderPlugin,
]
