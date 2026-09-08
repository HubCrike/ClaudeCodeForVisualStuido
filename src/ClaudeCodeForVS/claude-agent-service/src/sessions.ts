/**
 * 会话存储访问模块
 *
 * Claude Code CLI 把每个会话保存为一个 JSONL 文件，路径形如：
 *   ~/.claude/projects/<编码后的工作目录>/<sessionId>.jsonl
 *
 * 目录名是工作目录路径把 `:` `\` `/` 替换成 `-` 得到的，例如
 *   D:\WebCode\SourceCode\Standard  ->  D--WebCode-SourceCode-Standard
 *
 * 由于该编码规则不保证长期稳定，本模块不依赖目录名反解路径，
 * 而是直接读取 JSONL 行内的 `cwd` 字段来判断会话属于哪个工作目录，
 * 目录名仅用于快速定位候选目录。
 */

import { createReadStream } from 'fs';
import { readdir, stat, unlink } from 'fs/promises';
import { createInterface } from 'readline';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from './utils/logger.js';

/** 会话摘要信息 */
export interface SessionSummary {
  sessionId: string;
  /** 会话所属工作目录（取自 JSONL 内的 cwd 字段） */
  cwd: string;
  /** 会话标题：首条用户消息的摘要 */
  title: string;
  /** 首条消息时间（毫秒时间戳） */
  createdAt: number;
  /** 最后修改时间（毫秒时间戳，取文件 mtime） */
  lastUpdatedAt: number;
  /** 用户 + 助手消息条数 */
  messageCount: number;
  /** 会话文件绝对路径 */
  filePath: string;
}

/** 历史消息（用于恢复会话时回填聊天界面） */
export interface HistoryMessage {
  role: 'user' | 'assistant';
  /**
   * user 角色为纯文本；
   * assistant 角色为若干行 JSON（SDK assistant 事件格式），
   * 以便前端 TimelineMessage 组件按既有逻辑渲染文本与工具调用。
   */
  content: string;
}

/** 会话根目录 */
function getProjectsRoot(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (configDir && configDir.trim()) {
    return join(configDir.trim(), 'projects');
  }
  return join(homedir(), '.claude', 'projects');
}

/** 把工作目录编码成 CLI 使用的目录名 */
function encodeProjectDirName(cwd: string): string {
  return cwd.replace(/[:\\/]/g, '-');
}

/** 路径规范化，用于比较两个工作目录是否相同 */
function normalizeCwd(p: string): string {
  return p.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
}

/** 从消息内容中提取纯文本 */
function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === 'object') {
        const b = block as { type?: string; text?: string };
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push(b.text);
        }
      }
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * 把首条用户消息整理成标题
 * 去掉 [track:...] 上下文引用、命令包装标签和多余空白
 */
function buildTitle(raw: string): string {
  let text = raw
    .replace(/\[track:[^\]]*\]/g, ' ')
    .replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return '(无标题会话)';
  }
  const MAX = 80;
  if (text.length > MAX) {
    text = text.slice(0, MAX) + '…';
  }
  return text;
}

/** 判断这一行是否为需要计入的真实对话消息 */
function isConversationLine(obj: { type?: string; isSidechain?: boolean; message?: unknown }): boolean {
  if (obj.isSidechain === true) {
    return false; // 子代理（sidechain）消息不计入主会话
  }
  return (obj.type === 'user' || obj.type === 'assistant') && !!obj.message;
}

/**
 * 扫描单个会话文件，提取摘要信息
 * 采用流式逐行读取，遇到足够信息即可提前结束以减少 IO
 */
async function readSessionSummary(filePath: string, sessionId: string): Promise<SessionSummary | null> {
  let cwd = '';
  let title = '';
  let createdAt = 0;
  let messageCount = 0;

  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line || line.charCodeAt(0) !== 123 /* '{' */) {
        continue;
      }

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (!cwd && typeof obj.cwd === 'string') {
        cwd = obj.cwd;
      }

      if (!isConversationLine(obj as { type?: string; isSidechain?: boolean; message?: unknown })) {
        continue;
      }

      messageCount++;

      if (!createdAt && typeof obj.timestamp === 'string') {
        const t = Date.parse(obj.timestamp);
        if (!Number.isNaN(t)) {
          createdAt = t;
        }
      }

      // 取首条用户消息作为标题（跳过工具结果回填产生的 user 行）
      if (!title && obj.type === 'user') {
        const message = obj.message as { content?: unknown } | undefined;
        const content = message?.content;
        const isToolResult =
          Array.isArray(content) &&
          content.some((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'tool_result');
        if (!isToolResult) {
          const text = extractText(content);
          if (text.trim()) {
            title = buildTitle(text);
          }
        }
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  if (messageCount === 0) {
    return null; // 空会话不展示
  }

  let lastUpdatedAt = createdAt;
  try {
    const st = await stat(filePath);
    lastUpdatedAt = st.mtimeMs;
  } catch {
    // 忽略，沿用 createdAt
  }

  return {
    sessionId,
    cwd,
    title: title || '(无标题会话)',
    createdAt: createdAt || lastUpdatedAt,
    lastUpdatedAt,
    messageCount,
    filePath,
  };
}

/** 候选会话文件 */
interface SessionCandidate {
  filePath: string;
  sessionId: string;
  mtimeMs: number;
}

/** 收集若干目录下的会话文件（含修改时间），按最近更新排序 */
async function collectCandidates(root: string, dirs: string[]): Promise<SessionCandidate[]> {
  const candidates: SessionCandidate[] = [];
  for (const dir of dirs) {
    const dirPath = join(root, dir);
    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) {
        continue;
      }
      const filePath = join(dirPath, f);
      try {
        const st = await stat(filePath);
        candidates.push({ filePath, sessionId: f.replace(/\.jsonl$/, ''), mtimeMs: st.mtimeMs });
      } catch {
        // 忽略无法访问的文件
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates;
}

/**
 * 读取候选文件并按目标工作目录过滤，结果追加到 results
 * @param scanLimit 最多读取的文件数，避免会话极多时全量读盘
 */
async function appendSummaries(
  candidates: SessionCandidate[],
  target: string | null,
  limit: number,
  scanLimit: number,
  seen: Set<string>,
  results: SessionSummary[]
): Promise<void> {
  let scanned = 0;
  for (const c of candidates) {
    if (results.length >= limit || scanned >= scanLimit) {
      break;
    }
    if (seen.has(c.sessionId)) {
      continue;
    }
    scanned++;
    try {
      const summary = await readSessionSummary(c.filePath, c.sessionId);
      if (!summary) {
        continue;
      }
      // 目录名编码是有损的（D:\a-b 与 D:\a\b 会编码成同名目录），
      // 因此始终以 JSONL 内的 cwd 字段做最终判定
      if (target && summary.cwd && normalizeCwd(summary.cwd) !== target) {
        continue;
      }
      seen.add(c.sessionId);
      results.push(summary);
    } catch (error) {
      logger.warn('Failed to read session file', { filePath: c.filePath, error: String(error) });
    }
  }
}

/**
 * 列出会话
 *
 * 目录策略：指定 cwd 时优先扫描编码后同名的目录（绝大多数情况下会话都在此），
 * 若结果不足再补扫其余目录，兼顾性能与健壮性（例如手工移动过文件、
 * 或该目录已被清空但会话存在于别处）。
 *
 * @param cwd     若提供，仅返回该工作目录下的会话
 * @param limit   最多返回条数（按最近更新排序），默认 50
 */
export async function listSessions(cwd?: string, limit = 50): Promise<SessionSummary[]> {
  const root = getProjectsRoot();
  const effectiveLimit = limit && limit > 0 ? limit : 50;

  let allDirs: string[];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    allDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error) {
    logger.warn('Sessions root not accessible', { root, error: String(error) });
    return [];
  }

  let primaryDirs = allDirs;
  let secondaryDirs: string[] = [];

  if (cwd) {
    const expected = encodeProjectDirName(cwd).toLowerCase();
    const matched = allDirs.filter((d) => d.toLowerCase() === expected);
    if (matched.length > 0) {
      primaryDirs = matched;
      secondaryDirs = allDirs.filter((d) => d.toLowerCase() !== expected);
    }
  }

  const target = cwd ? normalizeCwd(cwd) : null;
  const results: SessionSummary[] = [];
  const seen = new Set<string>();

  // 优先目录：文件基本都属于目标 cwd，可以放宽读取上限
  const primaryCandidates = await collectCandidates(root, primaryDirs);
  await appendSummaries(
    primaryCandidates,
    target,
    effectiveLimit,
    Math.max(effectiveLimit * 2, 100),
    seen,
    results
  );

  // 结果不足时补扫其余目录
  if (results.length < effectiveLimit && secondaryDirs.length > 0) {
    const secondaryCandidates = await collectCandidates(root, secondaryDirs);
    await appendSummaries(
      secondaryCandidates,
      target,
      effectiveLimit,
      Math.max(effectiveLimit * 4, 200),
      seen,
      results
    );
  }

  results.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
  logger.info('Listed sessions', {
    root,
    cwd,
    primaryDirs: primaryDirs.length,
    secondaryScanned: secondaryDirs.length,
    returned: results.length,
  });
  return results;
}

/** 按 sessionId 查找会话文件路径 */
async function findSessionFile(sessionId: string): Promise<string | null> {
  // 防止路径穿越：sessionId 只允许出现文件名安全字符
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    logger.warn('Rejected suspicious sessionId', { sessionId });
    return null;
  }

  const root = getProjectsRoot();
  let dirs: string[];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }

  for (const dir of dirs) {
    const filePath = join(root, dir, `${sessionId}.jsonl`);
    try {
      await stat(filePath);
      return filePath;
    } catch {
      // 继续找下一个目录
    }
  }
  return null;
}

/** 删除会话文件 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const filePath = await findSessionFile(sessionId);
  if (!filePath) {
    logger.warn('Session file not found for delete', { sessionId });
    return false;
  }
  try {
    await unlink(filePath);
    logger.info('Deleted session', { sessionId, filePath });
    return true;
  } catch (error) {
    logger.error('Failed to delete session', { sessionId, error: String(error) });
    return false;
  }
}

/**
 * 读取会话历史消息，用于恢复会话时回填聊天界面
 *
 * 输出格式与实时对话保持一致：
 * - user 消息为纯文本
 * - assistant 消息为 SDK `assistant` 事件的 JSON 行，前端按既有逻辑渲染
 */
export async function getSessionHistory(sessionId: string): Promise<HistoryMessage[]> {
  const filePath = await findSessionFile(sessionId);
  if (!filePath) {
    logger.warn('Session file not found for history', { sessionId });
    return [];
  }

  const messages: HistoryMessage[] = [];
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line || line.charCodeAt(0) !== 123) {
        continue;
      }

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (obj.isSidechain === true) {
        continue;
      }

      const message = obj.message as { content?: unknown; role?: string } | undefined;
      if (!message) {
        continue;
      }

      if (obj.type === 'user') {
        const content = message.content;
        // 跳过工具结果回填的 user 行
        const isToolResult =
          Array.isArray(content) &&
          content.some((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'tool_result');
        if (isToolResult) {
          continue;
        }
        const text = extractText(content);
        if (text.trim()) {
          messages.push({ role: 'user', content: text });
        }
        continue;
      }

      if (obj.type === 'assistant') {
        const content = message.content;
        if (!Array.isArray(content)) {
          continue;
        }
        // 只保留前端会渲染的块类型，避免把 thinking 等内部内容暴露出来
        const blocks = content.filter((b) => {
          if (!b || typeof b !== 'object') return false;
          const t = (b as { type?: string }).type;
          return t === 'text' || t === 'tool_use';
        });
        if (blocks.length === 0) {
          continue;
        }

        const eventLine = JSON.stringify({ type: 'assistant', message: { content: blocks } });

        // 连续的 assistant 行合并到同一条消息，保持与实时流式渲染一致的分组
        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant') {
          last.content += eventLine + '\n';
        } else {
          messages.push({ role: 'assistant', content: eventLine + '\n' });
        }
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  logger.info('Loaded session history', { sessionId, messages: messages.length });
  return messages;
}
