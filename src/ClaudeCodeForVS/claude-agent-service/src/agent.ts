/**
 * Claude Agent SDK 封装
 * 提供与 SDK 交互的核心逻辑
 */

import {
  query,
  type Query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
  type SDKAssistantMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type SDKPartialAssistantMessage,
  type PermissionResult,
  type CanUseTool,
} from '@anthropic-ai/claude-agent-sdk';
import { logger } from './utils/logger.js';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

/**
 * 查找 Claude CLI 的 cli.js 文件路径
 * 
 * Windows 下 claude.cmd 会调用 node_modules/@anthropic-ai/claude-code/cli.js
 * 我们需要找到这个实际的 JS 文件路径
 */
function findClaudeExecutable(): string {
  // Windows: 通过 where 命令找到 claude.cmd 的位置
  if (process.platform === 'win32') {
    try {
      const result = execSync('where claude.cmd', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const paths = result.trim().split('\n');
      
      for (const p of paths) {
        const cmdPath = p.trim();
        if (existsSync(cmdPath)) {
          // claude.cmd 通常在 node_modules/.bin/ 或 npm 全局目录
          // cli.js 位于同级的 node_modules/@anthropic-ai/claude-code/cli.js
          const cmdDir = dirname(cmdPath);
          
          // 尝试多个可能的路径
          const possiblePaths = [
            join(cmdDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
            join(cmdDir, '..', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
            join(cmdDir, '..', '..', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
          ];
          
          for (const cliPath of possiblePaths) {
            if (existsSync(cliPath)) {
              logger.info('Found Claude CLI cli.js', { path: cliPath });
              return cliPath;
            }
          }
          
          logger.warn('Found claude.cmd but could not locate cli.js', { cmdPath, tried: possiblePaths });
        }
      }
    } catch (error) {
      logger.warn('Failed to find claude.cmd via where command', { error: String(error) });
    }
  } else {
    // Unix-like: 查找 claude 可执行文件
    try {
      const result = execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const claudePath = result.trim();
      
      if (existsSync(claudePath)) {
        // Unix 下可能是符号链接或 shell 脚本，需要找到实际的 cli.js
        const claudeDir = dirname(claudePath);
        const possiblePaths = [
          join(claudeDir, '..', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
          join(claudeDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        ];
        
        for (const cliPath of possiblePaths) {
          if (existsSync(cliPath)) {
            logger.info('Found Claude CLI cli.js', { path: cliPath });
            return cliPath;
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to find claude via which command', { error: String(error) });
    }
  }

  // 如果找不到，抛出详细错误
  throw new Error(
    'Could not locate Claude CLI cli.js file. Please ensure Claude CLI is installed via:\n' +
    '  npm install -g @anthropic-ai/claude-code\n' +
    'Or specify the path manually.'
  );
}

export interface QueryOptions {
  prompt: string;
  workingDirectory: string;
  sessionId?: string;
  systemPrompt?: string;
  maxTurns?: number;
  model?: string;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  suggestions?: unknown[];
  blockedPath?: string;
  decisionReason?: string;
}

export type PermissionDecision = 
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

export type AgentEventHandler = (event: SDKMessage) => void;
export type PermissionRequestHandler = (request: PermissionRequest) => Promise<PermissionDecision>;

export class ClaudeAgentWrapper {
  private currentQuery: Query | null = null;
  private abortController: AbortController | null = null;

  /**
   * 执行查询
   */
  async runQuery(
    options: QueryOptions,
    onEvent: AgentEventHandler,
    onPermissionRequest: PermissionRequestHandler
  ): Promise<{ sessionId: string; success: boolean }> {
    
    if (this.currentQuery) {
      throw new Error('A query is already in progress');
    }

    this.abortController = new AbortController();

    // 创建权限处理回调
    const canUseTool: CanUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
      callbackOptions
    ): Promise<PermissionResult> => {
      const requestId = crypto.randomUUID();

      logger.info('Permission request', { 
        requestId, 
        toolName,
        toolUseId: callbackOptions.toolUseID 
      });

      try {
        const decision = await onPermissionRequest({
          requestId,
          toolName,
          toolInput: input,
          toolUseId: callbackOptions.toolUseID,
          suggestions: callbackOptions.suggestions,
          blockedPath: callbackOptions.blockedPath,
          decisionReason: callbackOptions.decisionReason,
        });

        if (decision.behavior === 'allow') {
          const result: PermissionResult = {
            behavior: 'allow',
            updatedInput: decision.updatedInput ?? input,
            toolUseID: callbackOptions.toolUseID,
          };
          // 只有当 allow 时才添加 updatedPermissions
          if (decision.updatedPermissions) {
            (result as { updatedPermissions?: unknown[] }).updatedPermissions = decision.updatedPermissions;
          }
          return result;
        } else {
          return {
            behavior: 'deny',
            message: decision.message,
            interrupt: decision.interrupt,
            toolUseID: callbackOptions.toolUseID,
          };
        }
      } catch (error) {
        logger.error('Permission handler error', { error });
        return {
          behavior: 'deny',
          message: 'Permission request failed: ' + String(error),
          interrupt: true,
          toolUseID: callbackOptions.toolUseID,
        };
      }
    };

    // 构建 SDK 选项
    let claudeExecutable: string | undefined;
    try {
      claudeExecutable = findClaudeExecutable();
    } catch (error) {
      // 如果找不到，不指定路径，让 SDK 尝试使用内置可执行文件
      logger.warn('Could not find Claude CLI, SDK will use built-in executable', { error: String(error) });
    }
    
    const sdkOptions: Options = {
      cwd: options.workingDirectory,
      abortController: this.abortController,
      canUseTool,
      includePartialMessages: true,
      model: options.model,
      maxTurns: options.maxTurns,
      // 读取用户配置文件 (~/.claude/settings.json)
      // 这样可以使用用户配置的 ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL 等环境变量
      settingSources: ['user', 'project', 'local'],
    };

    // 只有找到了 Claude CLI 路径才设置
    if (claudeExecutable) {
      sdkOptions.pathToClaudeCodeExecutable = claudeExecutable;
    }

    // 处理会话恢复
    if (options.sessionId) {
      sdkOptions.resume = options.sessionId;
    }

    logger.info('Starting query', { 
      prompt: options.prompt.substring(0, 100),
      cwd: options.workingDirectory,
      sessionId: options.sessionId 
    });

    let sessionId = options.sessionId || '';
    let success = false;

    try {
      this.currentQuery = query({
        prompt: options.prompt,
        options: sdkOptions,
      });

      // 遍历事件流
      for await (const event of this.currentQuery) {
        // 从第一个消息获取 session_id
        if (!sessionId && 'session_id' in event) {
          sessionId = event.session_id;
        }

        // 发送事件到处理器
        onEvent(event);

        // 检查是否是结果消息
        if (event.type === 'result') {
          const resultEvent = event as SDKResultMessage;
          success = resultEvent.subtype === 'success';
          
          if (!success) {
            logger.warn('Query ended with error', { 
              subtype: resultEvent.subtype 
            });
          }
        }
      }

      logger.info('Query completed', { sessionId, success });

    } catch (error) {
      logger.error('Query failed', { error: String(error) });
      
      onEvent({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: [String(error)],
        duration_ms: 0,
        duration_api_ms: 0,
        num_turns: 0,
        total_cost_usd: 0,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
        session_id: sessionId,
      } as SDKResultMessage);
      
      throw error;
    } finally {
      this.currentQuery = null;
      this.abortController = null;
    }

    return { sessionId, success };
  }

  /**
   * 中断当前查询
   */
  async interrupt(): Promise<void> {
    if (this.currentQuery) {
      logger.info('Interrupting query');
      await this.currentQuery.interrupt();
    }
    
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * 取消当前查询
   */
  cancel(): void {
    if (this.abortController) {
      logger.info('Cancelling query');
      this.abortController.abort();
    }
  }

  /**
   * 检查是否有正在运行的查询
   */
  isRunning(): boolean {
    return this.currentQuery !== null;
  }

  /**
   * 列出可用的会话
   */
  async listSessions(limit?: number): Promise<Array<{
    sessionId: string;
    createdAt: number;
    lastUpdatedAt: number;
    messageCount: number;
  }>> {
    // SDK 目前没有直接的会话列表 API，需要从文件系统读取
    // 这里返回空数组作为占位符，实际实现需要访问 ~/.claude/projects 目录
    logger.info('listSessions called', { limit });
    
    // TODO: 实现从 ~/.claude/projects 目录读取会话列表
    return [];
  }

  /**
   * 恢复会话
   */
  async resumeSession(
    sessionId: string,
    prompt: string | undefined,
    workingDirectory: string,
    onEvent: AgentEventHandler,
    onPermissionRequest: PermissionRequestHandler
  ): Promise<{ sessionId: string; success: boolean }> {
    
    logger.info('Resuming session', { sessionId, hasPrompt: !!prompt });

    // 如果有新的 prompt，使用 runQuery 并传入 sessionId
    if (prompt) {
      return this.runQuery(
        {
          prompt,
          workingDirectory,
          sessionId,
        },
        onEvent,
        onPermissionRequest
      );
    }

    // 如果没有 prompt，只是恢复会话状态
    // 这在 SDK 中通过 resume 选项实现
    return {
      sessionId,
      success: true,
    };
  }
}

// 单例实例
let agentInstance: ClaudeAgentWrapper | null = null;

export function getAgent(): ClaudeAgentWrapper {
  if (!agentInstance) {
    agentInstance = new ClaudeAgentWrapper();
  }
  return agentInstance;
}
