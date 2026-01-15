/**
 * Hooks 系统 - 允许在工具执行前后注入自定义逻辑
 * 
 * 注意：这是一个预留的扩展点。Claude Agent SDK 的 hooks 功能可能会在未来版本中提供。
 * 目前使用 canUseTool 回调来实现权限控制。
 */

import { logger } from './utils/logger.js';

export type HookPhase = 'before' | 'after';

export interface ToolHookContext {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  phase: HookPhase;
}

export interface BeforeToolHookResult {
  // 是否允许执行
  allow: boolean;
  // 修改后的输入（可选）
  modifiedInput?: Record<string, unknown>;
  // 拒绝原因（如果 allow = false）
  denyReason?: string;
}

export interface AfterToolHookResult {
  // 修改后的输出（可选）
  modifiedOutput?: unknown;
}

export type BeforeToolHook = (context: ToolHookContext) => Promise<BeforeToolHookResult>;
export type AfterToolHook = (context: ToolHookContext, result: unknown) => Promise<AfterToolHookResult>;

/**
 * Hooks 管理器
 */
export class HooksManager {
  private beforeHooks: Map<string, BeforeToolHook[]> = new Map();
  private afterHooks: Map<string, AfterToolHook[]> = new Map();
  private globalBeforeHooks: BeforeToolHook[] = [];
  private globalAfterHooks: AfterToolHook[] = [];

  /**
   * 注册工具专用的 before hook
   */
  registerBeforeHook(toolName: string, hook: BeforeToolHook): void {
    const hooks = this.beforeHooks.get(toolName) || [];
    hooks.push(hook);
    this.beforeHooks.set(toolName, hooks);
    logger.info('Registered before hook', { toolName });
  }

  /**
   * 注册工具专用的 after hook
   */
  registerAfterHook(toolName: string, hook: AfterToolHook): void {
    const hooks = this.afterHooks.get(toolName) || [];
    hooks.push(hook);
    this.afterHooks.set(toolName, hooks);
    logger.info('Registered after hook', { toolName });
  }

  /**
   * 注册全局 before hook（对所有工具生效）
   */
  registerGlobalBeforeHook(hook: BeforeToolHook): void {
    this.globalBeforeHooks.push(hook);
    logger.info('Registered global before hook');
  }

  /**
   * 注册全局 after hook（对所有工具生效）
   */
  registerGlobalAfterHook(hook: AfterToolHook): void {
    this.globalAfterHooks.push(hook);
    logger.info('Registered global after hook');
  }

  /**
   * 执行 before hooks
   */
  async runBeforeHooks(context: ToolHookContext): Promise<BeforeToolHookResult> {
    let currentInput = context.toolInput;

    // 执行全局 hooks
    for (const hook of this.globalBeforeHooks) {
      const result = await hook({ ...context, toolInput: currentInput });
      if (!result.allow) {
        return result;
      }
      if (result.modifiedInput) {
        currentInput = result.modifiedInput;
      }
    }

    // 执行工具专用 hooks
    const toolHooks = this.beforeHooks.get(context.toolName) || [];
    for (const hook of toolHooks) {
      const result = await hook({ ...context, toolInput: currentInput });
      if (!result.allow) {
        return result;
      }
      if (result.modifiedInput) {
        currentInput = result.modifiedInput;
      }
    }

    return { allow: true, modifiedInput: currentInput };
  }

  /**
   * 执行 after hooks
   */
  async runAfterHooks(context: ToolHookContext, result: unknown): Promise<AfterToolHookResult> {
    let currentOutput = result;

    // 执行全局 hooks
    for (const hook of this.globalAfterHooks) {
      const hookResult = await hook(context, currentOutput);
      if (hookResult.modifiedOutput !== undefined) {
        currentOutput = hookResult.modifiedOutput;
      }
    }

    // 执行工具专用 hooks
    const toolHooks = this.afterHooks.get(context.toolName) || [];
    for (const hook of toolHooks) {
      const hookResult = await hook(context, currentOutput);
      if (hookResult.modifiedOutput !== undefined) {
        currentOutput = hookResult.modifiedOutput;
      }
    }

    return { modifiedOutput: currentOutput };
  }

  /**
   * 清除所有 hooks
   */
  clearAll(): void {
    this.beforeHooks.clear();
    this.afterHooks.clear();
    this.globalBeforeHooks = [];
    this.globalAfterHooks = [];
    logger.info('Cleared all hooks');
  }
}

// 单例实例
let hooksManagerInstance: HooksManager | null = null;

export function getHooksManager(): HooksManager {
  if (!hooksManagerInstance) {
    hooksManagerInstance = new HooksManager();
  }
  return hooksManagerInstance;
}

/**
 * 内置 Hooks 示例
 */

/**
 * 日志 Hook - 记录所有工具调用
 */
export const loggingBeforeHook: BeforeToolHook = async (context) => {
  logger.info('Tool execution starting', {
    toolName: context.toolName,
    toolUseId: context.toolUseId,
    inputKeys: Object.keys(context.toolInput),
  });
  return { allow: true };
};

export const loggingAfterHook: AfterToolHook = async (context, result) => {
  logger.info('Tool execution completed', {
    toolName: context.toolName,
    toolUseId: context.toolUseId,
    hasResult: result !== undefined,
  });
  return {};
};

/**
 * 路径验证 Hook - 确保文件操作只在允许的目录内
 */
export function createPathValidationHook(allowedPaths: string[]): BeforeToolHook {
  return async (context) => {
    const pathTools = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep'];
    
    if (!pathTools.includes(context.toolName)) {
      return { allow: true };
    }

    const pathInput = context.toolInput.file_path || 
                      context.toolInput.path || 
                      context.toolInput.filePath;

    if (typeof pathInput !== 'string') {
      return { allow: true };
    }

    const isAllowed = allowedPaths.some(allowed => 
      pathInput.startsWith(allowed) || pathInput.startsWith(allowed.replace(/\\/g, '/'))
    );

    if (!isAllowed) {
      logger.warn('Path validation failed', { 
        toolName: context.toolName, 
        path: pathInput,
        allowedPaths 
      });
      return { 
        allow: false, 
        denyReason: `Path ${pathInput} is outside allowed directories` 
      };
    }

    return { allow: true };
  };
}
