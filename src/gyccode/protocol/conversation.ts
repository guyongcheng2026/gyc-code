export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data?: string; mimeType?: string; uri?: string }
  | { type: 'tool_call'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; output: unknown }
  | { type: 'reasoning'; text: string };

export interface ConversationMessage {
  readonly role: Role;
  readonly content: readonly ContentPart[];
}

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_schema'; schema: unknown }
  | { type: 'regex'; pattern: string }
  | { type: 'ebnf'; grammar: string };

export type ThinkingMode = 'disabled' | 'enabled' | 'adaptive';

export interface ThinkingConfig {
  readonly mode: ThinkingMode;
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly budgetTokens?: number;
}

export interface ToolDef {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly namespace?: string;
  readonly clientExecuted?: boolean;
}

export interface Conversation {
  readonly messages: readonly ConversationMessage[];
  readonly images?: readonly { data?: string; mimeType?: string; uri?: string }[];
  readonly tools?: readonly ToolDef[];
  readonly format?: ResponseFormat;
  readonly thinking?: ThinkingConfig;
  readonly logprobs?: boolean;
  readonly topLogprobs?: number;
  readonly seed?: number;
  readonly deferredToolLoading?: boolean;
}

export interface ConversionOptions {
  readonly modelAlias?: string;
  readonly deepSeekV4?: boolean;
}

interface MessagesRequest {
  readonly model?: string;
  readonly messages: readonly Array<{
    readonly role: string;
    readonly content: string | readonly Array<{ readonly type: string; readonly text?: string }>;
  }>;
}

interface ChatCompletionsRequest {
  readonly model?: string;
  readonly messages: readonly Array<{
    readonly role: string;
    readonly content: string | readonly Array<{ readonly type: string; readonly text?: string }>;
  }>;
  readonly response_format?: { readonly type: 'text' | 'json_schema'; readonly json_schema?: unknown };
}

interface ResponsesRequest {
  readonly model?: string;
  readonly input: string | readonly Array<{
    readonly role: string;
    readonly content: string | readonly Array<{ readonly type: string; readonly text?: string }>;
  }>;
  readonly text?: { readonly format: { readonly type: 'text' | 'json_schema' } };
}

interface AcpPromptRequest {
  readonly sessionId: string;
  readonly messageId?: string | null;
  readonly prompt: readonly Array<{
    readonly type: 'text' | 'image' | 'audio' | 'resource_link' | 'resource';
    readonly text?: string;
    readonly data?: string;
    readonly mimeType?: string;
    readonly uri?: string | null;
  }>;
}

function isAcpPromptRequest(input: unknown): input is AcpPromptRequest {
  return (
    typeof input === 'object' &&
    input !== null &&
    'sessionId' in input &&
    'prompt' in input &&
    Array.isArray((input as AcpPromptRequest).prompt)
  );
}

function isResponsesRequest(input: unknown): input is ResponsesRequest {
  return (
    typeof input === 'object' &&
    input !== null &&
    'input' in input &&
    !('messages' in input)
  );
}

function isChatCompletionsRequest(input: unknown): input is ChatCompletionsRequest {
  return (
    typeof input === 'object' &&
    input !== null &&
    'messages' in input &&
    'response_format' in input
  );
}

function isMessagesRequest(input: unknown): input is MessagesRequest {
  return typeof input === 'object' && input !== null && 'messages' in input;
}

function contentPartFromText(text: string): ContentPart {
  return { type: 'text', text };
}

function contentPartFromImage(image: {
  readonly data?: string;
  readonly mimeType?: string;
  readonly uri?: string | null;
  readonly deepSeekV4?: boolean;
}): ContentPart {
  if (image.deepSeekV4) {
    return { type: 'text', text: '[Unsupported Image]' };
  }
  return {
    type: 'image',
    data: image.data,
    mimeType: image.mimeType,
    uri: image.uri ?? undefined,
  };
}

function messageContent(
  content: string | readonly Array<{ readonly type: string; readonly text?: string }> | undefined,
  opts: { deepSeekV4: boolean },
): ContentPart[] {
  if (content === undefined) return [];
  if (typeof content === 'string') return [contentPartFromText(content)];
  return content.flatMap((item) => {
    if (item.type === 'text') return [contentPartFromText(item.text ?? '')];
    if (item.type === 'image') return [contentPartFromImage({ data: undefined, mimeType: undefined, uri: undefined, deepSeekV4: opts.deepSeekV4 })];
    return [];
  });
}

function acpContentPart(block: {
  readonly type: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
  readonly uri?: string | null;
}, opts: { deepSeekV4: boolean }): ContentPart[] {
  switch (block.type) {
    case 'text':
      return [contentPartFromText(block.text ?? '')];
    case 'image':
      return [contentPartFromImage({ data: block.data, mimeType: block.mimeType, uri: block.uri, deepSeekV4: opts.deepSeekV4 })];
    case 'resource_link':
    case 'resource':
    case 'audio':
      return [{ type: 'text', text: block.text ?? block.uri ?? '' }];
    default:
      return [];
  }
}

function convertMessagesRequest(input: MessagesRequest, opts: { deepSeekV4: boolean }): Conversation {
  return {
    messages: input.messages.map((m) => ({
      role: (m.role === 'system' || m.role === 'user' || m.role === 'assistant' || m.role === 'tool') ? m.role : 'user',
      content: messageContent(m.content, opts),
    })),
    format: { type: 'text' },
  };
}

function convertChatCompletionsRequest(input: ChatCompletionsRequest, opts: { deepSeekV4: boolean }): Conversation {
  const format: ResponseFormat =
    input.response_format?.type === 'json_schema'
      ? { type: 'json_schema', schema: input.response_format.json_schema }
      : { type: 'text' };
  return {
    messages: input.messages.map((m) => ({
      role: (m.role === 'system' || m.role === 'user' || m.role === 'assistant' || m.role === 'tool') ? m.role : 'user',
      content: messageContent(m.content, opts),
    })),
    format,
  };
}

function convertResponsesRequest(input: ResponsesRequest, opts: { deepSeekV4: boolean }): Conversation {
  const contentParts: ContentPart[] =
    typeof input.input === 'string' ? [contentPartFromText(input.input)] : messageContent(input.input, opts);
  const format: ResponseFormat =
    input.text?.format?.type === 'json_schema'
      ? { type: 'json_schema', schema: {} }
      : { type: 'text' };
  return {
    messages: [{ role: 'user', content: contentParts }],
    format,
  };
}

function convertAcpPromptRequest(input: AcpPromptRequest, opts: { deepSeekV4: boolean }): Conversation {
  return {
    messages: [
      {
        role: 'user',
        content: input.prompt.flatMap((block) => acpContentPart(block, opts)),
      },
    ],
    format: { type: 'text' },
  };
}

/**
 * 统一请求格式转换层。
 * 将 Messages / Chat Completions / Responses / ACP Prompt 四种外部请求格式
 * 统一转为内部 `Conversation` 中间表示，再由渲染器生成模型专属 Prompt。
 * DeepSeek V4 不接受图像，转换时用 `[Unsupported Image]` 占位符替换。
 */
export function convertRequest(input: unknown, options: ConversionOptions = {}): Conversation {
  const deepSeekV4 = options.deepSeekV4 === true;
  if (isAcpPromptRequest(input)) return convertAcpPromptRequest(input, { deepSeekV4 });
  if (isResponsesRequest(input)) return convertResponsesRequest(input, { deepSeekV4 });
  if (isChatCompletionsRequest(input)) return convertChatCompletionsRequest(input, { deepSeekV4 });
  if (isMessagesRequest(input)) return convertMessagesRequest(input, { deepSeekV4 });
  return { messages: [], format: { type: 'text' } };
}
