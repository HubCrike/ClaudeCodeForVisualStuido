<template>
    <Teleport to="body">
        <Transition name="fade">
            <div v-if="show" class="permission-overlay" @click.self="onDeny">
                <div class="permission-dialog" :class="riskClass">
                    <div class="dialog-header">
                        <div class="header-icon" :class="riskClass">
                            <svg v-if="risk === 'high'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                <line x1="12" y1="9" x2="12" y2="13"/>
                                <line x1="12" y1="17" x2="12.01" y2="17"/>
                            </svg>
                            <svg v-else-if="risk === 'medium'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="8" x2="12" y2="12"/>
                                <line x1="12" y1="16" x2="12.01" y2="16"/>
                            </svg>
                            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="16" x2="12" y2="12"/>
                                <line x1="12" y1="8" x2="12.01" y2="8"/>
                            </svg>
                        </div>
                        <div class="header-content">
                            <h3 class="dialog-title">权限请求</h3>
                            <p class="dialog-subtitle">Claude 想要使用以下工具</p>
                        </div>
                    </div>

                    <div class="dialog-body">
                        <div class="tool-info">
                            <div class="tool-name">
                                <span class="tool-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                                    </svg>
                                </span>
                                {{ toolName }}
                            </div>
                            <div v-if="description" class="tool-description">
                                {{ description }}
                            </div>
                        </div>

                        <div class="tool-input-section">
                            <div class="section-header" @click="toggleInputExpanded">
                                <span class="section-title">工具参数</span>
                                <svg class="expand-icon" :class="{ expanded: inputExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="6 9 12 15 18 9"/>
                                </svg>
                            </div>
                            <Transition name="slide">
                                <div v-if="inputExpanded" class="input-content">
                                    <pre class="input-json">{{ formattedInput }}</pre>
                                </div>
                            </Transition>
                        </div>

                        <div class="risk-indicator" :class="riskClass">
                            <span class="risk-label">风险等级:</span>
                            <span class="risk-value">{{ riskLabel }}</span>
                        </div>
                    </div>

                    <div class="dialog-footer">
                        <button class="btn btn-secondary" @click="onDeny">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                            拒绝
                        </button>
                        <button class="btn btn-allow-always" @click="onAllowAlways">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            始终允许
                        </button>
                        <button class="btn btn-primary" @click="onAllow">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            允许
                        </button>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

interface Props {
    show: boolean
    requestId: string
    toolName: string
    toolInput: Record<string, unknown>
    description?: string
    risk: 'low' | 'medium' | 'high'
}

interface Emits {
    (e: 'allow', requestId: string): void
    (e: 'allowAlways', requestId: string): void
    (e: 'deny', requestId: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const inputExpanded = ref(false)

const riskClass = computed(() => `risk-${props.risk}`)

const riskLabel = computed(() => {
    switch (props.risk) {
        case 'high': return '高'
        case 'medium': return '中'
        default: return '低'
    }
})

const formattedInput = computed(() => {
    try {
        return JSON.stringify(props.toolInput, null, 2)
    } catch {
        return String(props.toolInput)
    }
})

function toggleInputExpanded() {
    inputExpanded.value = !inputExpanded.value
}

function onAllow() {
    emit('allow', props.requestId)
}

function onAllowAlways() {
    emit('allowAlways', props.requestId)
}

function onDeny() {
    emit('deny', props.requestId)
}
</script>

<style scoped>
.permission-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(2px);
}

.permission-dialog {
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-widget-border, #454545);
    border-radius: 8px;
    width: 90%;
    max-width: 480px;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.permission-dialog.risk-high {
    border-color: #f14c4c;
}

.permission-dialog.risk-medium {
    border-color: #cca700;
}

.permission-dialog.risk-low {
    border-color: #3794ff;
}

.dialog-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    border-bottom: 1px solid var(--vscode-widget-border, #454545);
}

.header-icon {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.header-icon.risk-high {
    background: rgba(241, 76, 76, 0.15);
    color: #f14c4c;
}

.header-icon.risk-medium {
    background: rgba(204, 167, 0, 0.15);
    color: #cca700;
}

.header-icon.risk-low {
    background: rgba(55, 148, 255, 0.15);
    color: #3794ff;
}

.header-content {
    flex: 1;
    min-width: 0;
}

.dialog-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--vscode-editor-foreground, #cccccc);
}

.dialog-subtitle {
    margin: 4px 0 0 0;
    font-size: 13px;
    color: var(--vscode-descriptionForeground, #8b8b8b);
}

.dialog-body {
    padding: 16px;
    overflow-y: auto;
    flex: 1;
}

.tool-info {
    margin-bottom: 16px;
}

.tool-name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-editor-foreground, #cccccc);
    padding: 10px 12px;
    background: var(--vscode-input-background, #3c3c3c);
    border-radius: 6px;
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
}

.tool-icon {
    display: flex;
    align-items: center;
    color: var(--vscode-descriptionForeground, #8b8b8b);
}

.tool-description {
    margin-top: 8px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #8b8b8b);
    line-height: 1.5;
}

.tool-input-section {
    border: 1px solid var(--vscode-widget-border, #454545);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 16px;
}

.section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--vscode-input-background, #3c3c3c);
    cursor: pointer;
    user-select: none;
}

.section-header:hover {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
}

.section-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--vscode-descriptionForeground, #8b8b8b);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.expand-icon {
    transition: transform 0.2s ease;
    color: var(--vscode-descriptionForeground, #8b8b8b);
}

.expand-icon.expanded {
    transform: rotate(180deg);
}

.input-content {
    padding: 12px;
    background: var(--vscode-editor-background, #1e1e1e);
}

.input-json {
    margin: 0;
    font-size: 12px;
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
    color: var(--vscode-editor-foreground, #cccccc);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
}

.risk-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
}

.risk-indicator.risk-high {
    background: rgba(241, 76, 76, 0.1);
    border: 1px solid rgba(241, 76, 76, 0.3);
}

.risk-indicator.risk-medium {
    background: rgba(204, 167, 0, 0.1);
    border: 1px solid rgba(204, 167, 0, 0.3);
}

.risk-indicator.risk-low {
    background: rgba(55, 148, 255, 0.1);
    border: 1px solid rgba(55, 148, 255, 0.3);
}

.risk-label {
    color: var(--vscode-descriptionForeground, #8b8b8b);
}

.risk-value {
    font-weight: 600;
}

.risk-high .risk-value {
    color: #f14c4c;
}

.risk-medium .risk-value {
    color: #cca700;
}

.risk-low .risk-value {
    color: #3794ff;
}

.dialog-footer {
    display: flex;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid var(--vscode-widget-border, #454545);
    justify-content: flex-end;
}

.btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
}

.btn-secondary {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #cccccc);
}

.btn-secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
}

.btn-allow-always {
    background: rgba(55, 148, 255, 0.15);
    color: #3794ff;
    border: 1px solid rgba(55, 148, 255, 0.3);
}

.btn-allow-always:hover {
    background: rgba(55, 148, 255, 0.25);
}

.btn-primary {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #ffffff);
}

.btn-primary:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
    transition: all 0.2s ease;
}

.slide-enter-from,
.slide-leave-to {
    opacity: 0;
    max-height: 0;
}

.slide-enter-to,
.slide-leave-from {
    opacity: 1;
    max-height: 300px;
}
</style>
