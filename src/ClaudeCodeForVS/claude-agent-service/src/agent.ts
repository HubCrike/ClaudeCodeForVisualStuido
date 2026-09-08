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
import {
  listSessions,
  deleteSession,
  getSessionHistory,
  type SessionSummary,
  type HistoryMessage,
} from './sessions.js';
import { execSync } from 'child_process';
import { existsSync, realpathSync, openSync, readSync, closeSync } from 'fs';
import { join, dirname } from 'path';

/**
 * 查找 Claude CLI 可执行文件路径
 *
 * 新版 Claude Code (2.x) 通过 npm 安装时是原生二进制分发（bin/claude.exe），
 * 包内没有 cli.js；旧版则是 node_modules/@anthropic-ai/claude-code/cli.js。
 * 两种形态都支持，优先返回原生二进制。
 */
function findClaudeExecutable(): string {
  if (process.platform === 'win32') {
    // Windows: `where claude` 会返回 PATH 中所有匹配项
    // （claude / claude.cmd / claude.ps1 shim，以及原生 claude.exe）
    try {
      const result = execSync('where claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      for (const line of result.trim().split('\n')) {
        const p = line.trim();
        if (!p || !existsSync(p)) {
          continue;
        }

        // 原生二进制（bin/claude.exe），可直接交给 SDK 执行
        if (/\.exe$/i.test(p)) {
          logger.info('Found Claude native executable', { path: p });
          return p;
        }

        // shim 脚本（claude / claude.cmd / claude.ps1）：推导包安装目录
        const cmdDir = dirname(p);
        const candidates = [
          // npm 全局目录结构: <prefix>\node_modules\@anthropic-ai\claude-code\...
          join(cmdDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
          join(cmdDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
          // 项目内 .bin 目录结构: <proj>\node_modules\.bin\claude.cmd
          join(cmdDir, '..', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
          join(cmdDir, '..', '@anthropic-ai', 'claude-code', 'cli.js'),
          // Unix 风格全局目录 (prefix/lib/node_modules)
          join(cmdDir, '..', '..', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
          join(cmdDir, '..', '..', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        ];

        for (const candidate of candidates) {
          if (existsSync(candidate)) {
            logger.info('Found Claude executable', { path: candidate });
            return candidate;
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to find claude via where command', { error: String(error) });
    }

    // 兜底: 通过 npm root -g 定位全局 node_modules
    try {
      const npmRoot = execSync('npm root -g', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      const candidates = [
        join(npmRoot, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
        join(npmRoot, '@anthropic-ai', 'claude-code', 'cli.js'),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          logger.info('Found Claude executable via npm root -g', { path: candidate });
          return candidate;
        }
      }
    } catch (error) {
      logger.warn('Failed to locate claude via npm root -g', { error: String(error) });
    }
  } else {
    // Unix-like: 查找 claude 可执行文件
    try {
      const result = execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const claudePath = result.trim();

      if (claudePath && existsSync(claudePath)) {
        // 解析符号链接，得到真实文件（可能是包内的 cli.js 或原生二进制）
        const realPath = realpathSync(claudePath);

        // 直接就是包内的 cli.js（旧版 npm 安装方式）
        if (/cli\.js$/.test(realPath)) {
          logger.info('Found Claude CLI cli.js', { path: realPath });
          return realPath;
        }

        // 原生安装器（~/.local/bin/claude 等）：claude 本身就是原生二进制，
        // 通过魔数（ELF / Mach-O）判断，避免误把 shell shim 当成二进制
        if (isNativeBinaryFile(realPath)) {
          logger.info('Found Claude native executable', { path: realPath });
          return realPath;
        }

        // shim 脚本：从所在目录推导包安装位置
        const claudeDir = dirname(realPath);
        const candidates = [
          join(claudeDir, '..', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude'),
          join(claudeDir, '..', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
          join(claudeDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude'),
          join(claudeDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        ];
        for (const candidate of candidates) {
          if (existsSync(candidate)) {
            logger.info('Found Claude executable', { path: candidate });
            return candidate;
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to find claude via which command', { error: String(error) });
    }
  }

  // 如果找不到，抛出详细错误
  throw new Error(
    'Could not locate Claude Code executable (cli.js or native binary). Please ensure Claude Code is installed via:\n' +
    '  npm install -g @anthropic-ai/claude-code\n' +
    'Or install the native installer from https://claude.com/claude-code'
  );
}

/**
 * 通过文件魔数判断是否为原生二进制（ELF / Mach-O），
 * 用于区分原生 Claude Code 可执行文件和 shell 脚本 shim
 */
function isNativeBinaryFile(filePath: string): boolean {
  try {
    const fd = openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(4);
      const bytesRead = readSync(fd, buf, 0, 4, 0);
      if (bytesRead < 4) {
        return false;
      }
      // ELF: 0x7F 'E' 'L' 'F' (Linux)
      if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
        return true;
      }
      // Mach-O: 0xFEEDFACE / 0xFEEDFACF / 0xCAFEBABE (macOS)
      const magic = buf.readUInt32BE(0);
      return magic === 0xfeedface || magic === 0xfeedfacf || magic === 0xcafebabe || magic === 0xcafebabf;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
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
      // 禁用 ToolSearch 工具。
      //
      // 背景：若用户在 ~/.claude/settings.json 的 env 中开启了 ENABLE_TOOL_SEARCH，
      // Claude Code 会额外提供一个 ToolSearch 工具用于"按需发现"工具。该机制是为
      // 挂载了大量 MCP 工具的场景设计的，但在本扩展场景下会严重误导模型：
      // 模型看到 ToolSearch 后会反复用它去搜索 Read/Edit/Write，而这些内置工具
      // 并不在可搜索的 deferred 列表中，搜索始终返回 "No matching deferred tools found"，
      // 最终模型会得出"没有可用的文件读取/编辑工具"的错误结论并放弃任务。
      //
      // 说明：SDK 的 env 选项无法覆盖 settings.json 中的同名变量（settings 优先级更高），
      // 因此改用 disallowedTools 将该工具从模型上下文中移除。经验证，移除后原先被
      // 标记为 deferred 的工具（WebFetch/WebSearch/NotebookEdit 等）会全部直接暴露，
      // 不会因此丢失任何能力。
      disallowedTools: ['ToolSearch'],
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
   *
   * @param cwd   按工作目录过滤；不传则返回全部
   * @param limit 最多返回条数
   */
  async listSessions(cwd?: string, limit?: number): Promise<SessionSummary[]> {
    logger.info('listSessions called', { cwd, limit });
    return listSessions(cwd, limit);
  }

  /**
   * 删除指定会话
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    logger.info('deleteSession called', { sessionId });
    return deleteSession(sessionId);
  }

  /**
   * 读取指定会话的历史消息
   */
  async getSessionHistory(sessionId: string): Promise<HistoryMessage[]> {
    logger.info('getSessionHistory called', { sessionId });
    return getSessionHistory(sessionId);
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
