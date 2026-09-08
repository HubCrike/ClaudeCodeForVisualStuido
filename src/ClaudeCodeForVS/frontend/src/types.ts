/**
 * 前端共享类型定义
 */

/** 历史会话条目 */
export type SessionItem = {
    sessionId: string
    /** 首条用户消息摘要，作为会话标题 */
    title: string
    /** 会话所属工作目录 */
    cwd: string
    messageCount: number
    createdAt: number
    lastUpdatedAt: number
}
