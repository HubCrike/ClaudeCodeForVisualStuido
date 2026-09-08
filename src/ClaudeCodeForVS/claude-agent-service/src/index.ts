/**
 * Claude Agent Service 入口点
 * 提供 C# 桥接的 IPC 服务
 */

import { IpcServer } from './ipc/server.js';
import {
  Methods,
  InitializeParams,
  InitializeResult,
  PingParams,
  PingResult,
  QueryParams,
  QueryResult,
  CancelParams,
  CancelResult,
  PermissionResponseParams,
  PermissionResponseResult,
  ListSessionsParams,
  ListSessionsResult,
  DeleteSessionParams,
  DeleteSessionResult,
  SessionHistoryParams,
  SessionHistoryResult,
  ResumeSessionParams,
  ResumeSessionResult,
} from './ipc/types.js';
import { logger } from './utils/logger.js';
import { getAgent, type PermissionRequest, type PermissionDecision } from './agent.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { tmpdir } from 'os';

const VERSION = '1.0.0';

class ClaudeAgentService {
  private server: IpcServer;
  private initialized = false;
  private workingDirectory: string | null = null;
  
  // 权限请求管理
  private pendingPermissions = new Map<string, {
    resolve: (decision: PermissionDecision) => void;
    reject: (error: Error) => void;
  }>();

  constructor() {
    this.server = new IpcServer();
    this.registerHandlers();
    logger.info('Service initialized', { 
      tempDir: tmpdir(), 
      platform: process.platform 
    });
  }

  private registerHandlers(): void {
    // Ping/Pong 测试
    this.server.onRequest<PingParams, PingResult>(
      Methods.PING,
      (params) => ({
        timestamp: params.timestamp,
        serverTimestamp: Date.now(),
      })
    );

    // 初始化
    this.server.onRequest<InitializeParams, InitializeResult>(
      Methods.INITIALIZE,
      (params) => {
        logger.info('Initialize request received', { 
          workingDirectory: params.workingDirectory 
        });
        
        this.workingDirectory = params.workingDirectory;
        this.initialized = true;
        
        return {
          success: true,
          version: VERSION,
        };
      }
    );

    // 查询 - 使用 SDK 执行
    this.server.onRequest<QueryParams, QueryResult>(
      Methods.QUERY,
      async (params) => {
        logger.info('Query request received', { 
          prompt: params.prompt.substring(0, 100),
          sessionId: params.sessionId 
        });

        if (!this.initialized || !this.workingDirectory) {
          throw new Error('Service not initialized');
        }

        const agent = getAgent();
        
        if (agent.isRunning()) {
          throw new Error('A query is already in progress');
        }

        // 发送查询开始事件
        this.server.notify(Methods.AGENT_EVENT, {
          type: 'query_start',
          data: {
            type: 'query_start',
            sessionId: params.sessionId || '',
            prompt: params.prompt,
          },
          timestamp: Date.now(),
        });

        try {
          const result = await agent.runQuery(
            {
              prompt: params.prompt,
              workingDirectory: this.workingDirectory,
              sessionId: params.sessionId,
              systemPrompt: params.systemPrompt,
              maxTurns: params.maxTurns,
            },
            // 事件处理器
            (event: SDKMessage) => this.handleAgentEvent(event),
            // 权限请求处理器
            (request: PermissionRequest) => this.handlePermissionRequest(request)
          );

          // 发送查询结束事件
          this.server.notify(Methods.AGENT_EVENT, {
            type: 'query_end',
            data: {
              type: 'query_end',
              sessionId: result.sessionId,
              success: result.success,
            },
            timestamp: Date.now(),
          });

          return {
            sessionId: result.sessionId,
            success: result.success,
          };
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // 发送错误事件
          this.server.notify(Methods.AGENT_EVENT, {
            type: 'error',
            data: {
              type: 'error',
              code: -1,
              message: errorMessage,
            },
            timestamp: Date.now(),
          });

          // 发送查询结束事件
          this.server.notify(Methods.AGENT_EVENT, {
            type: 'query_end',
            data: {
              type: 'query_end',
              sessionId: params.sessionId || '',
              success: false,
              error: errorMessage,
            },
            timestamp: Date.now(),
          });

          throw error;
        }
      }
    );

    // 取消
    this.server.onRequest<CancelParams, CancelResult>(
      Methods.CANCEL,
      (params) => {
        logger.info('Cancel request received', { reason: params.reason });
        
        const agent = getAgent();
        agent.cancel();
        
        // 取消所有待处理的权限请求
        for (const [requestId, pending] of this.pendingPermissions) {
          pending.reject(new Error('Query cancelled'));
          this.pendingPermissions.delete(requestId);
        }
        
        return { cancelled: true };
      }
    );

    // 权限响应
    this.server.onRequest<PermissionResponseParams, PermissionResponseResult>(
      Methods.PERMISSION_RESPONSE,
      (params) => {
        logger.info('Permission response received', { 
          requestId: params.requestId,
          decision: params.decision 
        });
        
        const pending = this.pendingPermissions.get(params.requestId);
        if (!pending) {
          logger.warn('No pending permission request found', { requestId: params.requestId });
          return { acknowledged: false };
        }

        this.pendingPermissions.delete(params.requestId);

        if (params.decision === 'allow' || params.decision === 'allowAlways') {
          pending.resolve({
            behavior: 'allow',
            updatedInput: undefined,
            updatedPermissions: params.decision === 'allowAlways' ? [] : undefined,
          });
        } else {
          pending.resolve({
            behavior: 'deny',
            message: params.reason || 'Permission denied by user',
            interrupt: false,
          });
        }

        return { acknowledged: true };
      }
    );

    // 关闭
    this.server.onRequest(Methods.SHUTDOWN, () => {
      logger.info('Shutdown request received');
      
      // 取消正在运行的查询
      const agent = getAgent();
      agent.cancel();
      
      setTimeout(() => {
        this.server.stop();
        process.exit(0);
      }, 100);
      
      return { success: true };
    });

    // 会话列表
    this.server.onRequest<ListSessionsParams, ListSessionsResult>(
      Methods.LIST_SESSIONS,
      async (params) => {
        const allProjects = params.allProjects === true;
        // 只有非空字符串才是有效的过滤目录，避免 null/'' 被误当作有效值
        const requestedCwd =
          typeof params.cwd === 'string' && params.cwd.trim() ? params.cwd.trim() : undefined;
        const effectiveCwd = allProjects
          ? undefined
          : requestedCwd ?? this.workingDirectory ?? undefined;

        logger.info('List sessions request received', {
          limit: params.limit,
          allProjects,
          requestedCwd,
          effectiveCwd,
        });

        // 要求按项目过滤但拿不到任何目录时返回空列表，
        // 避免静默降级成"全部会话"而误导使用者
        if (!allProjects && !effectiveCwd) {
          logger.warn('Project-scoped listing requested without a working directory');
          return { sessions: [] };
        }

        const agent = getAgent();
        const sessions = await agent.listSessions(effectiveCwd, params.limit);

        return {
          sessions: sessions.map((s) => ({
            sessionId: s.sessionId,
            createdAt: s.createdAt,
            lastUpdatedAt: s.lastUpdatedAt,
            messageCount: s.messageCount,
            cwd: s.cwd,
            title: s.title,
          })),
        };
      }
    );

    // 删除会话
    this.server.onRequest<DeleteSessionParams, DeleteSessionResult>(
      Methods.DELETE_SESSION,
      async (params) => {
        logger.info('Delete session request received', { sessionId: params.sessionId });

        if (!params.sessionId) {
          throw new Error('sessionId is required');
        }

        const agent = getAgent();
        const deleted = await agent.deleteSession(params.sessionId);
        return { deleted };
      }
    );

    // 会话历史
    this.server.onRequest<SessionHistoryParams, SessionHistoryResult>(
      Methods.SESSION_HISTORY,
      async (params) => {
        logger.info('Session history request received', { sessionId: params.sessionId });

        if (!params.sessionId) {
          throw new Error('sessionId is required');
        }

        const agent = getAgent();
        const messages = await agent.getSessionHistory(params.sessionId);
        return { messages };
      }
    );

    // 恢复会话
    this.server.onRequest<ResumeSessionParams, ResumeSessionResult>(
      Methods.RESUME_SESSION,
      async (params) => {
        logger.info('Resume session request received', { 
          sessionId: params.sessionId,
          hasPrompt: !!params.prompt 
        });

        if (!this.initialized || !this.workingDirectory) {
          throw new Error('Service not initialized');
        }

        const agent = getAgent();
        
        if (agent.isRunning()) {
          throw new Error('A query is already in progress');
        }

        // 如果有 prompt，发送查询开始事件
        if (params.prompt) {
          this.server.notify(Methods.AGENT_EVENT, {
            type: 'query_start',
            data: {
              type: 'query_start',
              sessionId: params.sessionId,
              prompt: params.prompt,
            },
            timestamp: Date.now(),
          });
        }

        try {
          const result = await agent.resumeSession(
            params.sessionId,
            params.prompt,
            this.workingDirectory,
            (event: SDKMessage) => this.handleAgentEvent(event),
            (request: PermissionRequest) => this.handlePermissionRequest(request)
          );

          // 发送查询结束事件
          if (params.prompt) {
            this.server.notify(Methods.AGENT_EVENT, {
              type: 'query_end',
              data: {
                type: 'query_end',
                sessionId: result.sessionId,
                success: result.success,
              },
              timestamp: Date.now(),
            });
          }

          return {
            success: result.success,
            sessionId: result.sessionId,
          };

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // 发送错误事件
          this.server.notify(Methods.AGENT_EVENT, {
            type: 'error',
            data: {
              type: 'error',
              code: -1,
              message: errorMessage,
            },
            timestamp: Date.now(),
          });

          throw error;
        }
      }
    );
  }

  /**
   * 处理 Agent 事件并转发到 C#
   * 
   * 设计原则：将 SDK 原生事件直接转发，前端负责解析和渲染
   * 这样可以保持 SDK 事件格式的完整性，前端可以根据需要渲染
   */
  private handleAgentEvent(event: SDKMessage): void {
    // 直接将 SDK 原生事件转发到 C#
    // C# 会将其序列化为 JSON 行，追加到消息内容中
    // 前端的 TimelineMessage.vue 会解析这些 JSON 行并渲染
    this.server.notify(Methods.AGENT_EVENT, {
      // 直接传递原生 SDK 事件，保持完整结构
      ...event,
      _timestamp: Date.now(),
    });
  }

  /**
   * 处理权限请求 - 发送到 C# 并等待响应
   */
  private async handlePermissionRequest(request: PermissionRequest): Promise<PermissionDecision> {
    logger.info('Sending permission request to client', { 
      requestId: request.requestId,
      toolName: request.toolName 
    });

    // 发送权限请求通知到 C#
    this.server.notify(Methods.PERMISSION_REQUEST, {
      requestId: request.requestId,
      toolName: request.toolName,
      toolInput: request.toolInput,
      description: request.decisionReason,
      risk: this.assessToolRisk(request.toolName),
    });

    // 等待 C# 响应
    return new Promise((resolve, reject) => {
      this.pendingPermissions.set(request.requestId, { resolve, reject });
      
      // 5 分钟超时
      setTimeout(() => {
        if (this.pendingPermissions.has(request.requestId)) {
          this.pendingPermissions.delete(request.requestId);
          reject(new Error('Permission request timeout'));
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * 评估工具风险等级
   */
  private assessToolRisk(toolName: string): 'low' | 'medium' | 'high' {
    const highRiskTools = ['Bash', 'Write', 'Edit', 'MultiEdit'];
    const mediumRiskTools = ['Read', 'Glob', 'Grep', 'WebFetch'];
    
    if (highRiskTools.includes(toolName)) {
      return 'high';
    } else if (mediumRiskTools.includes(toolName)) {
      return 'medium';
    }
    return 'low';
  }

  start(): void {
    logger.info(`Claude Agent Service v${VERSION} starting...`);
    this.server.start();
  }
}

// 主入口
const service = new ClaudeAgentService();
service.start();

// 优雅关闭
process.on('SIGINT', () => {
  logger.info('Received SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM');
  process.exit(0);
});
