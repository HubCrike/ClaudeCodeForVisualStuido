/**
 * IPC 类型定义
 * JSON-RPC 2.0 风格的消息协议
 */

// ============================================================================
// 基础 JSON-RPC 类型
// ============================================================================

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: T;
  error?: JsonRpcError;
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================================================
// 标准错误码
// ============================================================================

export const ErrorCodes = {
  // JSON-RPC 标准错误
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  
  // 自定义错误 (-32000 to -32099)
  AGENT_NOT_INITIALIZED: -32001,
  QUERY_IN_PROGRESS: -32002,
  QUERY_CANCELLED: -32003,
  PERMISSION_DENIED: -32004,
  SESSION_NOT_FOUND: -32005,
} as const;

// ============================================================================
// 请求方法类型
// ============================================================================

/** 初始化请求 */
export interface InitializeParams {
  workingDirectory: string;
  apiKey?: string;
  model?: string;
}

export interface InitializeResult {
  success: boolean;
  version: string;
}

/** 查询请求 */
export interface QueryParams {
  prompt: string;
  sessionId?: string;
  systemPrompt?: string;
  maxTurns?: number;
}

export interface QueryResult {
  sessionId: string;
  success: boolean;
}

/** 取消请求 */
export interface CancelParams {
  reason?: string;
}

export interface CancelResult {
  cancelled: boolean;
}

/** 权限响应 */
export interface PermissionResponseParams {
  requestId: string;
  decision: 'allow' | 'deny' | 'allowAlways';
  reason?: string;
}

export interface PermissionResponseResult {
  acknowledged: boolean;
}

/** 会话列表请求 */
export interface ListSessionsParams {
  limit?: number;
}

export interface SessionInfo {
  sessionId: string;
  createdAt: number;
  lastUpdatedAt: number;
  messageCount: number;
}

export interface ListSessionsResult {
  sessions: SessionInfo[];
}

/** 恢复会话请求 */
export interface ResumeSessionParams {
  sessionId: string;
  prompt?: string;
}

export interface ResumeSessionResult {
  success: boolean;
  sessionId: string;
}

/** Ping/Pong 测试 */
export interface PingParams {
  timestamp: number;
}

export interface PingResult {
  timestamp: number;
  serverTimestamp: number;
}

// ============================================================================
// 通知类型 (服务 -> 客户端)
// ============================================================================

/** Agent 事件通知 */
export interface AgentEventParams {
  type: AgentEventType;
  data: AgentEventData;
  timestamp: number;
}

export type AgentEventType = 
  | 'text'           // 文本输出
  | 'tool_use'       // 工具调用开始
  | 'tool_result'    // 工具调用结果
  | 'query_start'    // 查询开始
  | 'query_end'      // 查询结束
  | 'error'          // 错误发生
  | 'turn_start'     // 新轮次开始
  | 'turn_end';      // 轮次结束

export type AgentEventData = 
  | TextEventData
  | ToolUseEventData
  | ToolResultEventData
  | QueryStartEventData
  | QueryEndEventData
  | ErrorEventData
  | TurnEventData;

export interface TextEventData {
  type: 'text';
  text: string;
  isPartial: boolean;
}

export interface ToolUseEventData {
  type: 'tool_use';
  toolId: string;
  toolName: string;
  input: unknown;
}

export interface ToolResultEventData {
  type: 'tool_result';
  toolId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface QueryStartEventData {
  type: 'query_start';
  sessionId: string;
  prompt: string;
}

export interface QueryEndEventData {
  type: 'query_end';
  sessionId: string;
  success: boolean;
  error?: string;
}

export interface ErrorEventData {
  type: 'error';
  code: number;
  message: string;
}

export interface TurnEventData {
  type: 'turn_start' | 'turn_end';
  turnNumber: number;
}

/** 权限请求通知 */
export interface PermissionRequestParams {
  requestId: string;
  toolName: string;
  toolInput: unknown;
  description?: string;
  risk: 'low' | 'medium' | 'high';
}

// ============================================================================
// 方法名常量
// ============================================================================

export const Methods = {
  // 请求方法
  INITIALIZE: 'initialize',
  QUERY: 'query',
  CANCEL: 'cancel',
  PERMISSION_RESPONSE: 'permission.response',
  PING: 'ping',
  SHUTDOWN: 'shutdown',
  LIST_SESSIONS: 'sessions.list',
  RESUME_SESSION: 'sessions.resume',
  
  // 通知方法
  AGENT_EVENT: 'agent.event',
  PERMISSION_REQUEST: 'permission.request',
  LOG: 'log',
} as const;

// ============================================================================
// 类型守卫
// ============================================================================

export function isJsonRpcRequest(obj: unknown): obj is JsonRpcRequest {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'jsonrpc' in obj &&
    (obj as JsonRpcRequest).jsonrpc === '2.0' &&
    'method' in obj &&
    'id' in obj
  );
}

export function isJsonRpcNotification(obj: unknown): obj is JsonRpcNotification {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'jsonrpc' in obj &&
    (obj as JsonRpcNotification).jsonrpc === '2.0' &&
    'method' in obj &&
    !('id' in obj)
  );
}

export function isJsonRpcResponse(obj: unknown): obj is JsonRpcResponse {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'jsonrpc' in obj &&
    (obj as JsonRpcResponse).jsonrpc === '2.0' &&
    'id' in obj &&
    ('result' in obj || 'error' in obj)
  );
}
