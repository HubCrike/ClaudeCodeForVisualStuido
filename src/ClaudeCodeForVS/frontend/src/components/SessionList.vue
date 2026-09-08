<template>
    <Teleport to="body">
        <div v-if="show" class="session-overlay" @click="emit('close')">
            <div class="session-panel" @click.stop>
                <!-- 头部：标题与过滤范围切换 -->
                <div class="panel-header">
                    <div class="header-title">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM2 8a6 6 0 1112 0A6 6 0 012 8zm6-4v4.25l3 1.8-.5.84L7.5 8.75V4H8z" />
                        </svg>
                        <span>历史会话</span>
                    </div>
                    <button class="close-btn" title="关闭" @click="emit('close')">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z" />
                        </svg>
                    </button>
                </div>

                <!-- 过滤范围 -->
                <div class="scope-tabs">
                    <button class="scope-tab" :class="{ active: onlyCurrentProject }"
                        @click="changeScope(true)">当前项目</button>
                    <button class="scope-tab" :class="{ active: !onlyCurrentProject }"
                        @click="changeScope(false)">全部</button>
                </div>

                <!-- 当前过滤目录，便于确认筛选范围 -->
                <div v-if="onlyCurrentProject && filterDirectory" class="filter-dir" :title="filterDirectory">
                    目录：{{ filterDirectory }}
                </div>

                <!-- 搜索 -->
                <div class="search-box">
                    <input ref="searchInput" v-model="searchQuery" type="text" placeholder="搜索会话..."
                        class="search-input" />
                </div>

                <!-- 错误提示 -->
                <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>

                <!-- 列表 -->
                <div class="session-list">
                    <div v-if="loading" class="list-hint">正在加载…</div>

                    <template v-else>
                        <div v-for="s in filteredSessions" :key="s.sessionId" class="session-item"
                            :class="{ current: s.sessionId === currentSessionId }" @click="onPick(s)">
                            <div class="item-main">
                                <div class="item-title">
                                    <span v-if="s.sessionId === currentSessionId" class="current-badge">当前</span>
                                    {{ s.title || '(无标题会话)' }}
                                </div>
                                <div class="item-meta">
                                    <span>{{ formatTime(s.lastUpdatedAt) }}</span>
                                    <span class="meta-dot">·</span>
                                    <span>{{ s.messageCount }} 条消息</span>
                                </div>
                                <div v-if="!onlyCurrentProject && s.cwd" class="item-cwd" :title="s.cwd">
                                    {{ shortenPath(s.cwd) }}
                                </div>
                            </div>

                            <!-- 删除：需二次确认 -->
                            <div class="item-actions" @click.stop>
                                <template v-if="confirmingId === s.sessionId">
                                    <button class="confirm-btn danger" title="确认删除"
                                        @click="confirmDelete(s.sessionId)">删除</button>
                                    <button class="confirm-btn" title="取消" @click="confirmingId = null">取消</button>
                                </template>
                                <button v-else class="delete-btn" title="删除此会话"
                                    @click="confirmingId = s.sessionId">
                                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10 3h3v1h-1v9c0 .55-.45 1-1 1H5c-.55 0-1-.45-1-1V4H3V3h3V2c0-.55.45-1 1-1h2c.55 0 1 .45 1 1v1zM7 2v1h2V2H7zM5 4v9h6V4H5zm1 1h1v7H6V5zm3 0h1v7H9V5z" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div v-if="filteredSessions.length === 0" class="list-hint">
                            <template v-if="searchQuery">没有匹配的会话</template>
                            <template v-else-if="onlyCurrentProject">
                                当前项目还没有历史会话
                                <div class="hint-sub">可切换到「全部」查看其他项目的会话</div>
                            </template>
                            <template v-else>还没有任何历史会话</template>
                        </div>
                    </template>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { SessionItem } from '../types'

const props = defineProps<{
    show: boolean
    sessions: SessionItem[]
    currentSessionId: string | null
    onlyCurrentProject: boolean
    loading: boolean
    errorMessage: string
    filterDirectory: string | null
}>()

const emit = defineEmits<{
    close: []
    pick: [sessionId: string]
    remove: [sessionId: string]
    'change-scope': [onlyCurrentProject: boolean]
}>()

const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const confirmingId = ref<string | null>(null)

const filteredSessions = computed(() => {
    const q = searchQuery.value.trim().toLowerCase()
    if (!q) return props.sessions
    return props.sessions.filter((s) =>
        (s.title || '').toLowerCase().includes(q) || (s.cwd || '').toLowerCase().includes(q)
    )
})

// 面板每次打开时重置搜索与确认态，并聚焦搜索框
watch(
    () => props.show,
    (visible) => {
        if (visible) {
            searchQuery.value = ''
            confirmingId.value = null
            nextTick(() => searchInput.value?.focus())
        }
    }
)

// 列表变化后清除残留的确认态，避免指向已删除的项
watch(
    () => props.sessions,
    () => {
        confirmingId.value = null
    }
)

function changeScope(onlyCurrent: boolean) {
    if (onlyCurrent === props.onlyCurrentProject) return
    emit('change-scope', onlyCurrent)
}

function onPick(s: SessionItem) {
    if (confirmingId.value) return // 正在确认删除时不触发切换
    if (s.sessionId === props.currentSessionId) {
        emit('close')
        return
    }
    emit('pick', s.sessionId)
}

function confirmDelete(sessionId: string) {
    confirmingId.value = null
    emit('remove', sessionId)
}

function formatTime(ts: number): string {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)

    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin} 分钟前`

    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const isSameDay = d.toDateString() === now.toDateString()
    if (isSameDay) return `今天 ${hhmm}`

    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hhmm}`

    const sameYear = d.getFullYear() === now.getFullYear()
    const md = `${d.getMonth() + 1}月${d.getDate()}日`
    return sameYear ? `${md} ${hhmm}` : `${d.getFullYear()}年${md}`
}

/** 过长的项目路径只保留结尾两级，完整路径通过 title 提示 */
function shortenPath(p: string): string {
    const parts = p.split(/[\\/]/).filter(Boolean)
    if (parts.length <= 2) return p
    return '…' + '\\' + parts.slice(-2).join('\\')
}
</script>

<style scoped>
.session-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 8vh;
}

.session-panel {
    width: min(460px, 92vw);
    max-height: 76vh;
    display: flex;
    flex-direction: column;
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    overflow: hidden;
}

.panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
}

.header-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-editor-foreground);
}

.close-btn {
    background: transparent;
    border: none;
    color: var(--vscode-icon-foreground);
    cursor: pointer;
    padding: 3px;
    border-radius: 3px;
    display: flex;
    opacity: 0.7;
}

.close-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    opacity: 1;
}

.scope-tabs {
    display: flex;
    gap: 4px;
    padding: 8px 12px 0;
}

.scope-tab {
    background: transparent;
    border: 1px solid transparent;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s;
}

.scope-tab:hover {
    background: var(--vscode-toolbar-hoverBackground);
}

.scope-tab.active {
    color: #fff;
    background: var(--claude-orange, #d97757);
}

.search-box {
    padding: 8px 12px;
}

.filter-dir {
    margin: 6px 12px 0;
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.75;
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
}
.search-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, rgba(255, 255, 255, 0.12));
    border-radius: 4px;
    color: var(--vscode-input-foreground);
    font-size: 12px;
    padding: 5px 8px;
    outline: none;
}

.search-input:focus {
    border-color: var(--claude-orange, #d97757);
}

.error-banner {
    margin: 0 12px 8px;
    padding: 6px 8px;
    font-size: 11px;
    border-radius: 4px;
    color: var(--vscode-inputValidation-errorForeground, #f48771);
    background: var(--vscode-inputValidation-errorBackground, rgba(244, 135, 113, 0.1));
    border: 1px solid var(--vscode-inputValidation-errorBorder, rgba(244, 135, 113, 0.35));
    word-break: break-word;
}

.session-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 6px 8px;
}

.session-item {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 8px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.15s;
}

.session-item:hover {
    background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.06));
}

.session-item.current {
    background: color-mix(in srgb, var(--claude-orange, #d97757) 12%, transparent);
}

.item-main {
    min-width: 0;
    flex: 1;
}

.item-title {
    font-size: 12px;
    color: var(--vscode-editor-foreground);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
}

.current-badge {
    display: inline-block;
    font-size: 10px;
    padding: 0 4px;
    margin-right: 4px;
    border-radius: 3px;
    color: #fff;
    background: var(--claude-orange, #d97757);
    vertical-align: 1px;
}

.item-meta {
    margin-top: 3px;
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.85;
    display: flex;
    gap: 4px;
    align-items: center;
}

.meta-dot {
    opacity: 0.6;
}

.item-cwd {
    margin-top: 2px;
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.7;
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.item-actions {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-shrink: 0;
}

.delete-btn {
    background: transparent;
    border: none;
    color: var(--vscode-icon-foreground);
    cursor: pointer;
    padding: 3px;
    border-radius: 3px;
    display: flex;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s;
}

.session-item:hover .delete-btn {
    opacity: 0.65;
}

.delete-btn:hover {
    opacity: 1 !important;
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-inputValidation-errorForeground, #f48771);
}

.confirm-btn {
    background: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.1));
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none;
    border-radius: 3px;
    font-size: 10.5px;
    padding: 3px 7px;
    cursor: pointer;
    white-space: nowrap;
}

.confirm-btn.danger {
    background: #a1260d;
    color: #fff;
}

.confirm-btn:hover {
    filter: brightness(1.15);
}

.list-hint {
    padding: 18px 12px;
    text-align: center;
    font-size: 11.5px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.8;
}

.hint-sub {
    margin-top: 4px;
    font-size: 10.5px;
    opacity: 0.75;
}
</style>
