/**
 * 自定义工具系统 - 允许注册自定义工具供 Claude 使用
 * 
 * 注意：Claude Agent SDK 的自定义工具功能可能需要通过 MCP（Model Context Protocol）实现。
 * 这里提供一个基础框架，实际集成需要根据 SDK 版本调整。
 */

import { logger } from './utils/logger.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      items?: { type: string };
      required?: boolean;
    }>;
    required?: string[];
  };
}

export type ToolExecutor = (input: Record<string, unknown>) => Promise<{
  success: boolean;
  result?: unknown;
  error?: string;
}>;

export interface CustomTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

/**
 * 自定义工具管理器
 */
export class CustomToolsManager {
  private tools: Map<string, CustomTool> = new Map();

  /**
   * 注册自定义工具
   */
  register(tool: CustomTool): void {
    if (this.tools.has(tool.definition.name)) {
      logger.warn('Overwriting existing tool', { name: tool.definition.name });
    }
    this.tools.set(tool.definition.name, tool);
    logger.info('Registered custom tool', { name: tool.definition.name });
  }

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    const deleted = this.tools.delete(name);
    if (deleted) {
      logger.info('Unregistered custom tool', { name });
    }
    return deleted;
  }

  /**
   * 获取工具定义列表
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * 执行工具
   */
  async execute(name: string, input: Record<string, unknown>): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
  }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` };
    }

    try {
      return await tool.executor(input);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Tool execution failed', { name, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取所有工具名称
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 清除所有工具
   */
  clearAll(): void {
    this.tools.clear();
    logger.info('Cleared all custom tools');
  }
}

// 单例实例
let customToolsManagerInstance: CustomToolsManager | null = null;

export function getCustomToolsManager(): CustomToolsManager {
  if (!customToolsManagerInstance) {
    customToolsManagerInstance = new CustomToolsManager();
  }
  return customToolsManagerInstance;
}

/**
 * 内置自定义工具示例
 */

/**
 * Visual Studio 文件操作工具 - 与 VS IDE 集成
 */
export const vsOpenFileTool: CustomTool = {
  definition: {
    name: 'VSOpenFile',
    description: 'Open a file in Visual Studio editor',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path to open',
        },
        line: {
          type: 'number',
          description: 'Optional line number to navigate to',
        },
        column: {
          type: 'number',
          description: 'Optional column number to navigate to',
        },
      },
      required: ['path'],
    },
  },
  executor: async (input) => {
    // 这个工具需要通过 IPC 调用 C# 端来实际打开文件
    // 这里只是定义，实际执行会被发送回 C#
    logger.info('VSOpenFile requested', { input });
    return {
      success: true,
      result: { message: 'File open request sent to Visual Studio' },
    };
  },
};

/**
 * Visual Studio 解决方案信息工具
 */
export const vsSolutionInfoTool: CustomTool = {
  definition: {
    name: 'VSSolutionInfo',
    description: 'Get information about the current Visual Studio solution',
    inputSchema: {
      type: 'object',
      properties: {
        includeProjects: {
          type: 'boolean',
          description: 'Whether to include project list',
        },
        includeReferences: {
          type: 'boolean',
          description: 'Whether to include project references',
        },
      },
    },
  },
  executor: async (input) => {
    logger.info('VSSolutionInfo requested', { input });
    return {
      success: true,
      result: { message: 'Solution info request sent to Visual Studio' },
    };
  },
};

/**
 * Visual Studio 构建工具
 */
export const vsBuildTool: CustomTool = {
  definition: {
    name: 'VSBuild',
    description: 'Build the current solution or project in Visual Studio',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Build target: "solution", "project", or project name',
        },
        configuration: {
          type: 'string',
          description: 'Build configuration (e.g., "Debug", "Release")',
          enum: ['Debug', 'Release'],
        },
        rebuild: {
          type: 'boolean',
          description: 'Whether to rebuild (clean + build)',
        },
      },
    },
  },
  executor: async (input) => {
    logger.info('VSBuild requested', { input });
    return {
      success: true,
      result: { message: 'Build request sent to Visual Studio' },
    };
  },
};
