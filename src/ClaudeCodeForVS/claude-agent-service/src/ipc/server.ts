/**
 * IPC 服务器
 * 基于 stdin/stdout 的 JSON-RPC 2.0 通信
 */

import { createInterface, Interface } from 'readline';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
  ErrorCodes,
  isJsonRpcRequest,
} from './types.js';
import { logger } from '../utils/logger.js';

type RequestHandler<TParams = unknown, TResult = unknown> = (
  params: TParams
) => Promise<TResult> | TResult;

type NotificationHandler<TParams = unknown> = (params: TParams) => void;

export class IpcServer {
  private readline: Interface | null = null;
  private requestHandlers = new Map<string, RequestHandler>();
  private notificationHandlers = new Map<string, NotificationHandler>();
  private isRunning = false;

  /**
   * 注册请求处理器
   */
  onRequest<TParams = unknown, TResult = unknown>(
    method: string,
    handler: RequestHandler<TParams, TResult>
  ): void {
    this.requestHandlers.set(method, handler as RequestHandler);
    logger.debug(`Registered request handler: ${method}`);
  }

  /**
   * 注册通知处理器
   */
  onNotification<TParams = unknown>(
    method: string,
    handler: NotificationHandler<TParams>
  ): void {
    this.notificationHandlers.set(method, handler as NotificationHandler);
    logger.debug(`Registered notification handler: ${method}`);
  }

  /**
   * 发送通知到客户端
   */
  notify<T>(method: string, params?: T): void {
    const notification: JsonRpcNotification<T> = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.send(notification);
  }

  /**
   * 发送响应
   */
  private respond<T>(id: string | number, result: T): void {
    const response: JsonRpcResponse<T> = {
      jsonrpc: '2.0',
      id,
      result,
    };
    this.send(response);
  }

  /**
   * 发送错误响应
   */
  private respondError(id: string | number | null, error: JsonRpcError): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error,
    };
    this.send(response);
  }

  /**
   * 发送消息到 stdout
   */
  private send(message: object): void {
    const json = JSON.stringify(message);
    process.stdout.write(json + '\n');
    // logger.debug('Sent message', { method: (message as { method?: string }).method });
  }

  /**
   * 处理收到的消息
   */
  private async handleMessage(line: string): Promise<void> {
    let parsed: unknown;
    
    try {
      parsed = JSON.parse(line);
    } catch {
      this.respondError(null, {
        code: ErrorCodes.PARSE_ERROR,
        message: 'Parse error: Invalid JSON',
      });
      return;
    }

    if (isJsonRpcRequest(parsed)) {
      await this.handleRequest(parsed);
    } else {
      this.respondError(null, {
        code: ErrorCodes.INVALID_REQUEST,
        message: 'Invalid request: Not a valid JSON-RPC request',
      });
    }
  }

  /**
   * 处理请求
   */
  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request;
    
    logger.debug(`Received request: ${method}`, { id });

    const handler = this.requestHandlers.get(method);
    
    if (!handler) {
      this.respondError(id, {
        code: ErrorCodes.METHOD_NOT_FOUND,
        message: `Method not found: ${method}`,
      });
      return;
    }

    try {
      const result = await handler(params);
      this.respond(id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error handling ${method}:`, { error: message });
      this.respondError(id, {
        code: ErrorCodes.INTERNAL_ERROR,
        message,
      });
    }
  }

  /**
   * 启动服务器
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('IPC server already running');
      return;
    }

    this.readline = createInterface({
      input: process.stdin,
      terminal: false,
    });

    this.readline.on('line', (line) => {
      if (line.trim()) {
        this.handleMessage(line).catch((err) => {
          logger.error('Unhandled error in message handler', { error: String(err) });
        });
      }
    });

    this.readline.on('close', () => {
      logger.info('stdin closed, shutting down');
      this.stop();
      process.exit(0);
    });

    this.isRunning = true;
    logger.info('IPC server started');
  }

  /**
   * 停止服务器
   */
  stop(): void {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    this.isRunning = false;
    logger.info('IPC server stopped');
  }
}
