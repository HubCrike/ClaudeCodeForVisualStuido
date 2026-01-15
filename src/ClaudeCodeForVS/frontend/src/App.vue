<template>
    <div class="root">
        <main ref="chatEl" class="chat" aria-label="chat messages" @click="handleChatClick">
            <WelcomeScreen v-if="state.messages.length === 0" />
            <template v-else>
                <template v-for="(m, idx) in state.messages" :key="idx">
                    <div class="row" :class="roleToClass(m.role)">
                        <div v-if="isUser(m.role)" class="user-message-wrapper">
                            <div class="bubble user-bubble">
                                <div class="content markdown-body" v-html="renderMarkdown(extractMessageText(m.content))"></div>
                            </div>
                            <!-- 引用控件 -->
                            <div v-for="(ref, refIdx) in extractReferences(m.content)" :key="refIdx" class="context-reference">
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="opacity: 0.6;">
                                    <path d="M13.71 4.29l-3-3L10 1H4c-.55 0-1 .45-1 1v12c0 .55.45 1 1 1h8c.55 0 1-.45 1-1V5l-.29-.71zM13 14H4V2h5v3h4v9zm-3-7H6v1h4V7z" />
                                </svg>
                                <span class="reference-text">
                                    {{ getFileName(ref.filePath) }}<span v-if="ref.startLine" class="reference-lines">:{{ ref.startLine }}-{{ ref.endLine }}</span>
                                </span>
                            </div>
                        </div>
                        <div v-else class="message-group assistant-message">
                            <TimelineMessage :content="m.content" />
                            <!-- 在assistant消息内容之后显示loading，仅针对最后一条消息 -->
                            <div v-if="state.isRunning && idx === state.messages.length - 1" class="loading-indicator">
                                <img src="./resources/claude-logo-pending.svg" class="loading-logo" alt="Claude thinking..." />
                                <span class="loading-text">Claude 正在思考...</span>
                            </div>
                        </div>
                    </div>
                </template>
            </template>
        </main>

        <footer class="composer">
            <div ref="composerRef" class="composer-container" :class="{ focused: isInputFocused }">
                <!-- 文件选择器 - 放在 composer-container 内部以便相对定位 -->
                <FilePicker
                    :show="showFilePicker"
                    :files="projectFiles"
                    @select="onFileSelect"
                    @close="showFilePicker = false"
                />
                
                <div class="input-area">
                    <textarea v-model="draft" class="composer-input" placeholder="Ask Claude..."
                        aria-label="prompt input" @keydown="onKeydown" @focus="isInputFocused = true"
                        @blur="isInputFocused = false" @input="onInput" ref="textareaRef" rows="1" />
                </div>

                <div class="composer-toolbar">
                    <div class="toolbar-left">
                        <!-- 编辑器上下文指示器 -->
                        <div v-if="editorContext" class="context-indicator" @click="toggleContextEnabled" 
                             :class="{ active: contextEnabled }" 
                             :title="getContextTooltip()">
                            <svg v-if="contextEnabled" width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
                                <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
                            </svg>
                            <svg v-else width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
                                <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
                                <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
                            </svg>
                            <span v-if="editorContext.hasSelection" class="context-text">
                                {{ getSelectionLineCount(editorContext) }} line{{ getSelectionLineCount(editorContext) > 1 ? 's' : '' }}
                            </span>
                            <span v-else class="context-text">{{ editorContext.fileName }}</span>
                        </div>
                    </div>
                    <div class="toolbar-right">
                        <button class="icon-btn" title="Add File Reference" @click="openFilePicker">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M14 7v1H9v5H8V8H3V7h5V2h1v5h5z" />
                            </svg>
                        </button>
                        <button class="send-btn" :disabled="!state.isRunning && runDisabled"
                            @click="state.isRunning ? cancel() : run()">
                            <svg v-if="state.isRunning" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                <rect x="2" y="2" width="12" height="12" rx="2" />
                            </svg>
                            <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                <path
                                    d="M8.00002 2.66666V13.3333M8.00002 2.66666L12.6667 7.33332M8.00002 2.66666L3.33335 7.33332"
                                    stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                                    stroke-linejoin="round" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </footer>

        <!-- 权限请求对话框 -->
        <PermissionDialog
            v-if="permissionRequest"
            :show="!!permissionRequest"
            :request-id="permissionRequest.requestId"
            :tool-name="permissionRequest.toolName"
            :tool-input="permissionRequest.toolInput"
            :description="permissionRequest.description"
            :risk="permissionRequest.risk"
            @allow="onPermissionAllow"
            @allow-always="onPermissionAllowAlways"
            @deny="onPermissionDeny"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import 'highlight.js/styles/vs2015.css' // VS 2015 dark theme, better matches VS Code
import WelcomeScreen from './components/WelcomeScreen.vue'
import TimelineMessage from './components/TimelineMessage.vue'
import FilePicker from './components/FilePicker.vue'
import PermissionDialog from './components/PermissionDialog.vue'
import { renderMarkdown } from './utils/markdown'

type EditorContext = {
    filePath: string
    fileName: string
    relativePath: string
    language: string
    selectedText: string
    selectionStartLine: number
    selectionEndLine: number
    currentLine: number
    hasSelection: boolean
}

type ChatMessage = {
    role: string
    content: string
}

type FileReference = {
    filePath: string
    startLine?: number
    endLine?: number
}

type FileItem = {
    name: string
    path: string
    directory: string
}

type PermissionRequestData = {
    requestId: string
    toolName: string
    toolInput: Record<string, unknown>
    description?: string
    risk: 'low' | 'medium' | 'high'
}

type HostStatePayload = {
    type: 'state'
    isRunning: boolean
    messages: ChatMessage[]
}
const showFilePicker = ref(false)
const projectFiles = ref<FileItem[]>([])
const atSignPosition = ref<number>(-1)
const permissionRequest = ref<PermissionRequestData | null>(null)

const chatEl = ref<HTMLDivElement | null>(null)
const composerRef = ref<HTMLDivElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const isInputFocused = ref(false)
const editorContext = ref<EditorContext | null>(null)
const contextEnabled = ref(true)

const state = reactive<{ messages: ChatMessage[]; isRunning: boolean }>({
    messages: [],
    isRunning: false,
})

const draft = ref('')

const runDisabled = computed(() => state.isRunning || !draft.value.trim())

function isUser(role: string) {
    return String(role || '').toLowerCase() === 'user'
}

function roleToClass(role: string) {
    const r = String(role || '').toLowerCase()
    if (r === 'user') return 'user'
    return 'assistant'
}

function post(msg: unknown) {
    const wv = (window as any).chrome?.webview
    if (wv && typeof wv.postMessage === 'function') {
        wv.postMessage(msg)
        return
    }
    // Dev/preview fallback - silently ignore
}

async function scrollToBottom() {
    await nextTick()
    if (!chatEl.value) return
    chatEl.value.scrollTop = chatEl.value.scrollHeight
}

function applyHostState(payload: HostStatePayload) {
    state.isRunning = !!payload.isRunning
    state.messages = Array.isArray(payload.messages) ? payload.messages : []
    void scrollToBottom()
}

function run() {
    let text = draft.value
    
    // 如果启用了上下文跟踪，隐式添加 Tracking 引用到消息末尾
    // 使用 [track:] 格式以区分手动 @ 引用
    if (contextEnabled.value && editorContext.value) {
        const ctx = editorContext.value
        
        if (ctx.hasSelection) {
            // 有选中代码时，添加文件引用（带行号）
            text = text + `\n\n[track:${ctx.relativePath}:${ctx.selectionStartLine}-${ctx.selectionEndLine}]`
        } else if (ctx.fileName) {
            // 没有选中代码时，只引用文件
            text = text + `\n\n[track:${ctx.relativePath}]`
        }
    }
    
    post({ type: 'run', text })
    draft.value = ''
    if (textareaRef.value) {
        textareaRef.value.style.height = 'auto';
    }
}

// 从消息内容中提取文本部分（移除 Tracking 引用，保留手动 @ 引用）
function extractMessageText(content: string): string {
    // 只移除 [track:] 格式的 Tracking 引用
    return content.replace(/\n\n\[track:[^\]]+\]/g, '').trim()
}

// 从消息内容中提取 Tracking 引用（只提取 [track:] 格式）
function extractReferences(content: string): FileReference[] {
    const refs: FileReference[] = []
    // 只匹配 [track:文件路径:行号-行号] 或 [track:文件路径] 格式
    const regex = /\[track:([^:\]]+)(?::(\d+)-(\d+))?\]/g
    let match
    
    while ((match = regex.exec(content)) !== null) {
        refs.push({
            filePath: match[1],
            startLine: match[2] ? parseInt(match[2]) : undefined,
            endLine: match[3] ? parseInt(match[3]) : undefined
        })
    }
    
    return refs
}

// 从完整路径中提取文件名
function getFileName(filePath: string): string {
    return filePath.split(/[\\/]/).pop() || filePath
}

function cancel() {
    post({ type: 'cancel' })
}

function getEditorContext() {
    post({ type: 'getEditorContext' })
}

function getSelectionLineCount(context: EditorContext): number {
    if (!context || !context.hasSelection) return 0
    return context.selectionEndLine - context.selectionStartLine + 1
}

function toggleContextEnabled() {
    contextEnabled.value = !contextEnabled.value
}

function getContextTooltip(): string {
    if (!editorContext.value) return ''
    
    if (!contextEnabled.value) {
        return 'Context tracking disabled - Click to enable'
    }
    
    if (editorContext.value.hasSelection) {
        const lineCount = getSelectionLineCount(editorContext.value)
        const lineText = lineCount > 1 ? 'lines' : 'line'
        return `Tracking ${lineCount} ${lineText} from ${editorContext.value.fileName}\nClick to disable context`
    }
    
    return `Tracking ${editorContext.value.fileName}\nClick to disable context`
}

function adjustHeight() {
    if (textareaRef.value) {
        textareaRef.value.style.height = 'auto';
        textareaRef.value.style.height = textareaRef.value.scrollHeight + 'px';
    }
}

function onInput() {
    adjustHeight()
    
    // 检测 @ 输入
    const value = draft.value
    const cursorPos = textareaRef.value?.selectionStart || 0
    
    // 检查光标前一个字符是否是 @
    if (value[cursorPos - 1] === '@') {
        // 检查 @ 前面是否是空格或开头
        const charBefore = value[cursorPos - 2]
        if (!charBefore || charBefore === ' ' || charBefore === '\n') {
            atSignPosition.value = cursorPos - 1
            showFilePickerAtCursor()
            requestProjectFiles()
        }
    }
}

function showFilePickerAtCursor() {
    showFilePicker.value = true
}

function requestProjectFiles() {
    post({ type: 'getProjectFiles' })
}

function openFilePicker() {
    // 通过 + 按钮打开文件选择器，此时 atSignPosition 保持 -1
    atSignPosition.value = -1
    showFilePicker.value = true
    requestProjectFiles()
}

function onFileSelect(file: FileItem) {
    if (!textareaRef.value) return
    
    if (atSignPosition.value === -1) {
        // 通过 + 按钮打开的，直接追加到末尾
        const currentText = draft.value
        const needsSpace = currentText.length > 0 && !currentText.endsWith(' ') && !currentText.endsWith('\n')
        draft.value = currentText + (needsSpace ? ' ' : '') + `\`@${file.path}\` `
    } else {
        // 通过 @ 触发的，替换 @ 为 `@文件路径`
        const before = draft.value.substring(0, atSignPosition.value)
        const after = draft.value.substring(atSignPosition.value + 1)
        draft.value = before + `\`@${file.path}\`` + after
    }
    
    // 关闭文件选择器
    showFilePicker.value = false
    atSignPosition.value = -1
    
    // 重新聚焦输入框
    nextTick(() => {
        textareaRef.value?.focus()
        adjustHeight()
    })
}

// 权限响应处理
function sendPermissionResponse(requestId: string, decision: 'allow' | 'deny' | 'allowAlways', reason?: string) {
    post({
        type: 'permissionResponse',
        requestId,
        decision,
        reason
    })
    permissionRequest.value = null
}

function onPermissionAllow(requestId: string) {
    sendPermissionResponse(requestId, 'allow')
}

function onPermissionAllowAlways(requestId: string) {
    sendPermissionResponse(requestId, 'allowAlways')
}

function onPermissionDeny(requestId: string) {
    sendPermissionResponse(requestId, 'deny')
}

function handleChatClick(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest('.copy-btn');
    if (target) {
        const btn = target as HTMLButtonElement;
        const code = decodeURIComponent(btn.dataset.code || '');
        if (code) {
            navigator.clipboard.writeText(code).then(() => {
                const originalHtml = btn.innerHTML;
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.innerHTML = originalHtml;
                    btn.classList.remove('copied');
                }, 2000);
            });
        }
    }
}

function onKeydown(e: KeyboardEvent) {
    // Enter to send, Shift+Enter for newline (Copilot Chat style)
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        if (!runDisabled.value) run()
        return
    }
}

onMounted(() => {
    const wv = (window as any).chrome?.webview
    if (wv && typeof wv.addEventListener === 'function') {
        wv.addEventListener('message', (ev: MessageEvent) => {
            const data = ev.data
            if (!data || typeof data !== 'object') return
            if ((data as any).type === 'state') {
                applyHostState(data as HostStatePayload)
            }
            if ((data as any).type === 'editorContext') {
                editorContext.value = (data as any).context
            }
            if ((data as any).type === 'projectFiles') {
                const files = (data as any).files || []
                projectFiles.value = files
            }
            if ((data as any).type === 'permissionRequest') {
                const req = data as any
                permissionRequest.value = {
                    requestId: req.requestId,
                    toolName: req.toolName,
                    toolInput: req.toolInput || {},
                    description: req.description,
                    risk: req.risk || 'medium'
                }
            }
        })

        post({ type: 'requestState' })
        
        // 定期获取编辑器上下文
        setInterval(() => {
            post({ type: 'getEditorContext' })
        }, 1000)
    }

    // 监听window.postMessage（用于接收来自C#的消息）
    window.addEventListener('message', (ev: MessageEvent) => {
        const data = ev.data
        if (!data || typeof data !== 'object') return
        if (data.type === 'editorContext') {
            editorContext.value = data.context
        }
        if (data.type === 'projectFiles') {
            const files = data.files || []
            projectFiles.value = files
            console.log('[App] Received projectFiles:', files)
        }
        if (data.type === 'permissionRequest') {
            permissionRequest.value = {
                requestId: data.requestId,
                toolName: data.toolName,
                toolInput: data.toolInput || {},
                description: data.description,
                risk: data.risk || 'medium'
            }
        }
    })
})
</script>

<style scoped>
.root {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--vscode-editor-foreground);
}

.chat {
    flex: 1;
    padding: 8px 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
}

.row {
    display: flex;
    width: 100%;
    min-width: 0;
}

.row.user {
    justify-content: flex-end;
}

.user-message-wrapper {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    max-width: 85%;
    min-width: 0;
}

.bubble.user-bubble {
    padding: 6px 12px;
    border-radius: 12px;
    border-bottom-right-radius: 2px;
    background: #0e639c;
    color: #ffffff;
    max-width: 100%;
    font-size: 13px;
    line-height: 1.4;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.bubble.user-bubble .content {
    word-wrap: break-word;
    word-break: break-word;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

/* 用户消息内的 Markdown 样式调整 */
.bubble.user-bubble .markdown-body {
    color: #ffffff;
}

.bubble.user-bubble .markdown-body p {
    margin: 0.3em 0;
}

.bubble.user-bubble .markdown-body p:first-child {
    margin-top: 0;
}

.bubble.user-bubble .markdown-body p:last-child {
    margin-bottom: 0;
}

.bubble.user-bubble .markdown-body code {
    background: rgba(255, 255, 255, 0.15);
    color: #ffffff;
}

.bubble.user-bubble .markdown-body pre {
    background: rgba(0, 0, 0, 0.2);
    border-color: rgba(255, 255, 255, 0.1);
    white-space: pre-wrap;
    word-break: break-all;
    overflow-wrap: anywhere;
}

.bubble.user-bubble .markdown-body pre code {
    background: none;
}

.context-reference {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    background: var(--vscode-editorWidget-background, rgba(255, 255, 255, 0.05));
    border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
    border-radius: 4px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
}

.reference-text {
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
}

.reference-lines {
    opacity: 0.7;
    word-break: break-word;
    overflow-wrap: anywhere;
}

/* Assistant Message */
.message-group.assistant-message {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    background: transparent;
    padding: 0;
    border-radius: 0;
    width: 100%;
    min-width: 0;
}

.message-group.assistant-message .content {
    width: 100%;
    font-size: 13px;
    line-height: 1.5;
}

/* Loading Indicator */
.loading-message {
    padding: 0;
}

.loading-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
    margin-top: 4px;
}

.loading-logo {
    width: 14px;
    height: 14px;
    animation: pulse 1.5s ease-in-out infinite;
}

.loading-text {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.8;
}

@keyframes pulse {
    0%, 100% {
        opacity: 1;
        transform: scale(1);
    }
    50% {
        opacity: 0.6;
        transform: scale(1.05);
    }
}

/* Composer */
.composer {
    padding: 8px 12px;
    background: var(--vscode-editor-background);
    border-top: 1px solid var(--vscode-widget-border);
}

.context-indicator {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 7px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    background: transparent;
}

.context-indicator:hover {
    background: var(--vscode-toolbar-hoverBackground);
}

.context-indicator.active {
    color: var(--claude-orange);
}

.context-indicator.active:hover {
    background: color-mix(in srgb, var(--claude-orange) 8%, transparent);
}

.context-text {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.composer-container {
    position: relative;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 6px;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    transition: border-color 0.2s, box-shadow 0.2s;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.15);
}

.composer-container.focused {
    border-color: var(--claude-orange);
    box-shadow: 0 0 0 1px var(--claude-orange), inset 0 1px 3px rgba(0, 0, 0, 0.2);
}

.input-area {
    width: 100%;
}

.composer-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: var(--vscode-input-foreground);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.4;
    resize: none;
    overflow-y: auto;
    max-height: 150px;
    padding: 0;
}

.composer-input::placeholder {
    color: var(--vscode-input-placeholderForeground);
}

.composer-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 2px;
}

.toolbar-left {
    display: flex;
    gap: 6px;
}

.pill {
    display: flex;
    align-items: center;
    font-size: 11px;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    padding: 3px 6px;
    border-radius: 3px;
    opacity: 0.9;
    cursor: default;
}

.toolbar-right {
    display: flex;
    gap: 6px;
    align-items: center;
}

.icon-btn {
    background: transparent;
    border: none;
    color: var(--vscode-icon-foreground);
    cursor: pointer;
    padding: 4px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    transition: all 0.2s;
}

.icon-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    opacity: 1;
}

.send-btn {
    background: var(--claude-orange);
    color: #ffffff;
    border: none;
    border-radius: 4px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.2s;
}

.send-btn:hover:not(:disabled) {
    background: var(--claude-orange-hover);
}

.send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--vscode-button-secondaryBackground);
}

/* Markdown Styles */
:deep(.markdown-body) {
    font-family: var(--vscode-font-family);
}

:deep(.markdown-body p) {
    margin: 0.5em 0;
}

:deep(.markdown-body p:first-child) {
    margin-top: 0;
}

:deep(.markdown-body p:last-child) {
    margin-bottom: 0;
}

:deep(.markdown-body code) {
    background: var(--vscode-textCodeBlock-background);
    padding: 0.15em 0.35em;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.9em;
    overflow-wrap: anywhere;
    word-wrap: break-word;
    word-break: break-word;
    white-space: pre-wrap;
}

:deep(.markdown-body pre) {
    background: var(--vscode-textBlockQuote-background);
    padding: 10px;
    border-radius: 4px;
    margin: 0.6em 0;
    position: relative;
    border: 1px solid var(--vscode-widget-border);
    white-space: pre-wrap;
    word-wrap: break-word;
    word-break: break-all;
    overflow-wrap: anywhere;
}

:deep(.markdown-body pre code) {
    background: none;
    padding: 0;
    border-radius: 0;
    color: inherit;
    white-space: pre-wrap;
    word-break: break-all;
    overflow-wrap: anywhere;
}

:deep(.code-block-wrapper) {
    position: relative;
    margin: 0.6em 0;
}

:deep(.copy-btn) {
    position: absolute;
    top: 6px;
    right: 6px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 3px;
    padding: 3px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s;
    color: var(--vscode-icon-foreground);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
}

:deep(.code-block-wrapper:hover .copy-btn) {
    opacity: 1;
}

:deep(.copy-btn:hover) {
    background: var(--vscode-toolbar-hoverBackground);
}

:deep(.copy-btn.copied) {
    color: var(--vscode-testing-iconPassed);
    border-color: var(--vscode-testing-iconPassed);
}
</style>

<style>
/* Global styles */
html, body {
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
}

#app {
    height: 100%;
}
</style>
