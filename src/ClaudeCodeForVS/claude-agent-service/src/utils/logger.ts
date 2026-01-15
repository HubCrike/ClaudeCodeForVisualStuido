/**
 * 日志工具
 * 输出到 stderr 以避免干扰 IPC 通信
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: unknown;
}

class Logger {
  private minLevel: LogLevel = 'info';
  
  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel];
  }

  private formatEntry(entry: LogEntry): string {
    const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
    const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
    return `${prefix} ${entry.message}${dataStr}`;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      data,
    };

    // 输出到 stderr 以避免干扰 stdout IPC
    process.stderr.write(this.formatEntry(entry) + '\n');
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }
}

export const logger = new Logger();

// 根据环境变量设置日志级别
if (process.env.LOG_LEVEL) {
  const level = process.env.LOG_LEVEL.toLowerCase() as LogLevel;
  if (['debug', 'info', 'warn', 'error'].includes(level)) {
    logger.setLevel(level);
  }
}
