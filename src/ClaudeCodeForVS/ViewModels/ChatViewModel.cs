using ClaudeCodeForVS.Models;
using ClaudeCodeForVS.Services;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Concurrent;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using System.Windows.Threading;

namespace ClaudeCodeForVS.ViewModels
{
    public class ChatViewModel : INotifyPropertyChanged
    {
        private string _userInput;
        private bool _isCancelEnabled;
        private bool _isRunning;
        private CancellationTokenSource _cts;

        // 当前会话 ID / Current session ID
        private string _currentSessionId;

        // UI 更新节流 / UI update throttling
        private static readonly TimeSpan UIUpdateInterval = TimeSpan.FromMilliseconds(50);

        // 使用无锁并发队列代替 StringBuilder + lock，避免调试时死锁 / Use lock-free queue to avoid debug deadlocks
        private readonly ConcurrentQueue<string> _pendingContent = new ConcurrentQueue<string>();

        private DispatcherTimer _updateTimer;
        private ChatMessage _currentAssistantMessage;

        /// <summary>
        /// 权限请求事件，UI 层需要订阅此事件来显示权限对话框
        /// </summary>
        public event Action<string, string, object, string, string> OnPermissionRequest;

        public ChatViewModel()
        {
            Messages = new ObservableCollection<ChatMessage>();
            RunCommand = new RelayCommand(OnRun, CanRun);
            CancelCommand = new RelayCommand(OnCancel, CanCancel);
            UserInput = string.Empty;

            InitializeUpdateTimer();
            SubscribeToAgentBridgeEvents();
        }

        private void InitializeUpdateTimer()
        {
            _updateTimer = new DispatcherTimer
            {
                Interval = UIUpdateInterval
            };
            _updateTimer.Tick += OnUpdateTimerTick;
        }

        private void SubscribeToAgentBridgeEvents()
        {
            ClaudeAgentBridge.Instance.OnAgentEvent += HandleAgentEvent;
            ClaudeAgentBridge.Instance.OnPermissionRequest += HandlePermissionRequest;
        }

        private void HandleAgentEvent(JObject eventData)
        {
            if (eventData == null)
                return;

            // 将原生 SDK 事件直接序列化为 JSON 行，追加到消息内容
            // 前端的 TimelineMessage.vue 会解析这些 JSON 行并渲染
            //
            // SDK 事件格式示例：
            // - stream_event: { type: "stream_event", event: { type: "content_block_delta", delta: { text: "..." } } }
            // - assistant: { type: "assistant", message: { content: [...] } }
            // - result: { type: "result", subtype: "success", ... }
            // - error: { type: "result", subtype: "error_during_execution", errors: [...] }

            var eventType = eventData["type"]?.Value<string>();

            // 过滤掉不需要显示的事件
            // - query_start/query_end: 内部控制事件
            // - assistant: 完整消息，与 stream_event 重复，不需要显示
            // - system: 系统初始化消息，不需要显示
            // - user: 用户消息已经单独显示，不需要重复
            if (eventType == "query_start" || eventType == "query_end" ||
                eventType == "assistant" || eventType == "system" || eventType == "user")
            {
                return;
            }

            // 将整个事件序列化为一行 JSON，追加到消息内容
            var jsonLine = eventData.ToString(Newtonsoft.Json.Formatting.None);
            _pendingContent.Enqueue(jsonLine + "\n");
        }

        private void HandlePermissionRequest(JObject requestData)
        {
            if (requestData == null)
                return;

            var requestId = requestData["requestId"]?.Value<string>();
            var toolName = requestData["toolName"]?.Value<string>();
            var toolInput = requestData["toolInput"] as JObject;
            var description = requestData["description"]?.Value<string>();
            var risk = requestData["risk"]?.Value<string>() ?? "medium";

            if (!string.IsNullOrEmpty(requestId) && !string.IsNullOrEmpty(toolName))
            {
                // 触发权限请求事件，由 UI 层处理
                OnPermissionRequest?.Invoke(requestId, toolName, toolInput, description, risk);
            }
        }

        private void OnUpdateTimerTick(object sender, EventArgs e)
        {
            FlushPendingContent();
        }

        private void FlushPendingContent()
        {
            if (_currentAssistantMessage == null || _pendingContent.IsEmpty)
                return;

            // 无锁方式收集所有待处理内容 / Collect pending content without locks
            var sb = new StringBuilder();
            while (_pendingContent.TryDequeue(out var chunk))
            {
                sb.Append(chunk);
            }

            if (sb.Length > 0)
            {
                _currentAssistantMessage.Content += sb.ToString();
            }
        }

        public ObservableCollection<ChatMessage> Messages { get; }

        public string UserInput
        {
            get => _userInput;
            set
            {
                if (_userInput != value)
                {
                    _userInput = value;
                    OnPropertyChanged(nameof(UserInput));
                    UpdateCommandStates();
                }
            }
        }

        public bool IsCancelEnabled
        {
            get => _isCancelEnabled;
            set
            {
                if (_isCancelEnabled != value)
                {
                    _isCancelEnabled = value;
                    OnPropertyChanged(nameof(IsCancelEnabled));
                    UpdateCommandStates();
                }
            }
        }

        public bool IsRunning
        {
            get => _isRunning;
            set
            {
                if (_isRunning != value)
                {
                    _isRunning = value;
                    OnPropertyChanged(nameof(IsRunning));
                    IsCancelEnabled = _isRunning;
                    UpdateCommandStates();
                }
            }
        }

        public ICommand RunCommand { get; }
        public ICommand CancelCommand { get; }

        private void UpdateCommandStates()
        {
            (RunCommand as RelayCommand)?.RaiseCanExecuteChanged();
            (CancelCommand as RelayCommand)?.RaiseCanExecuteChanged();
        }

        private bool CanRun(object parameter)
        {
            return !IsRunning && !string.IsNullOrWhiteSpace(UserInput);
        }

        private async void OnRun(object parameter)
        {
            if (CanRun(parameter))
            {
                var prompt = UserInput;
                // 添加用户消息 / Add user message
                Messages.Add(new ChatMessage("User", prompt));

                // 清空输入框 / Clear input box
                UserInput = string.Empty;

                // 准备 Assistant 消息 / Prepare assistant message
                var assistantMessage = new ChatMessage("Assistant", "");
                Messages.Add(assistantMessage);
                _currentAssistantMessage = assistantMessage;

                IsRunning = true;
                _cts = new CancellationTokenSource();
                _updateTimer.Start();

                try
                {
                    var workingDir = await GetWorkingDirectoryAsync();
                    await RunWithAgentBridgeAsync(prompt, workingDir, assistantMessage);
                }
                catch (OperationCanceledException)
                {
                    FlushPendingContent();
                    assistantMessage.Content += Environment.NewLine + "[Canceled]";
                }
                catch (TimeoutException ex)
                {
                    FlushPendingContent();
                    assistantMessage.Content += Environment.NewLine + "[Timeout]: " + ex.Message;
                    LogService.Warn("Request timed out", ex);
                }
                catch (Exception ex)
                {
                    FlushPendingContent();
                    assistantMessage.Content += Environment.NewLine + "[Error]: " + ex.Message;
                    LogService.Error("OnRun failed", ex);
                }
                finally
                {
                    _updateTimer.Stop();
                    FlushPendingContent();
                    _currentAssistantMessage = null;
                    IsRunning = false;
                    _cts?.Dispose();
                    _cts = null;
                    await ReloadChangedFilesAsync();
                }
            }
        }

        /// <summary>
        /// 使用 Agent SDK Bridge 执行查询
        /// </summary>
        private async Task RunWithAgentBridgeAsync(string prompt, string workingDir, ChatMessage assistantMessage)
        {
            var bridge = ClaudeAgentBridge.Instance;

            // 初始化 Bridge - 现在会抛出详细异常
            var initialized = await bridge.InitializeAsync(workingDir, _cts.Token);
            if (!initialized)
            {
                throw new Exception("Failed to initialize Claude Agent Bridge. InitializeAsync returned false.");
            }

            // 发送查询
            var response = await bridge.QueryAsync(prompt, _currentSessionId, _cts.Token);

            // 处理响应
            if (response != null)
            {
                var result = response["result"];
                if (result != null)
                {
                    // 更新会话 ID
                    _currentSessionId = result["sessionId"]?.Value<string>();

                    // 获取响应文本
                    var responseText = result["response"]?.Value<string>();
                    if (!string.IsNullOrEmpty(responseText))
                    {
                        _pendingContent.Enqueue(responseText);
                    }

                    // 检查是否有错误
                    var error = result["error"]?.Value<string>();
                    if (!string.IsNullOrEmpty(error))
                    {
                        _pendingContent.Enqueue($"\n[SDK Error]: {error}");
                    }
                }

                // 检查顶级错误
                var topError = response["error"];
                if (topError != null)
                {
                    var errorMessage = topError["message"]?.Value<string>() ?? "Unknown error";
                    throw new Exception($"Agent Bridge error: {errorMessage}");
                }
            }
        }

        private async Task ReloadChangedFilesAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

            // TODO: Agent SDK Bridge 需要实现文件变更跟踪
            // 目前 SDK 模式下暂不支持自动重新加载
            LogService.Debug("ReloadChangedFilesAsync called (not implemented for SDK mode)");
        }

        private async Task<string> GetSolutionDirectoryAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            if (ServiceProvider.GlobalProvider.GetService(typeof(SVsSolution)) is IVsSolution solution)
            {
                solution.GetSolutionInfo(out var solutionDir, out _, out _);
                return solutionDir;
            }
            return null;
        }

        /// <summary>
        /// 获取用于 Agent 的工作目录
        ///
        /// 会话按目录归档，因此发起查询与筛选历史会话必须使用同一个目录，
        /// 否则筛选结果会为空。所有需要工作目录的地方都应调用此方法。
        ///
        /// 取值顺序：解决方案目录 → 当前打开文件所在目录 → null
        /// </summary>
        private async Task<string> GetWorkingDirectoryAsync()
        {
            var solutionDir = await GetSolutionDirectoryAsync();
            if (!string.IsNullOrEmpty(solutionDir))
            {
                return solutionDir.TrimEnd(
                    System.IO.Path.DirectorySeparatorChar,
                    System.IO.Path.AltDirectorySeparatorChar);
            }

            // 未打开解决方案（例如"打开文件夹"模式）时，退回到当前文件所在目录
            try
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                var context = EditorContextService.Instance.GetCurrentContext();
                if (!string.IsNullOrEmpty(context?.FilePath))
                {
                    var dir = System.IO.Path.GetDirectoryName(context.FilePath);
                    if (!string.IsNullOrEmpty(dir))
                    {
                        LogService.Info($"[Session] Falling back to document directory: {dir}");
                        return dir;
                    }
                }
            }
            catch (Exception ex)
            {
                LogService.Warn("Failed to resolve working directory from editor context", ex);
            }

            return null;
        }

        private bool CanCancel(object parameter)
        {
            return IsRunning;
        }

        /// <summary>
        /// 当前会话 ID，为空表示尚未开始会话
        /// </summary>
        public string CurrentSessionId => _currentSessionId;

        /// <summary>
        /// 新建会话：清空聊天记录并丢弃当前会话 ID
        /// 下一次提问将由 SDK 创建全新会话，因此不会携带此前的上下文
        /// </summary>
        public void NewSession()
        {
            if (IsRunning)
            {
                // 正在运行时先取消，避免残留事件写入新会话
                try
                {
                    _cts?.Cancel();
                    _ = ClaudeAgentBridge.Instance.CancelAsync("New session");
                }
                catch (Exception ex)
                {
                    LogService.Warn("Failed to cancel before new session", ex);
                }
            }

            _updateTimer.Stop();
            while (_pendingContent.TryDequeue(out _)) { }
            _currentAssistantMessage = null;
            _currentSessionId = null;
            Messages.Clear();
            IsRunning = false;

            LogService.Info("[Session] Started new session");
        }

        /// <summary>
        /// 历史会话查询结果
        /// </summary>
        public class SessionListResult
        {
            /// <summary>会话数组</summary>
            public JArray Sessions { get; set; }

            /// <summary>本次实际用于过滤的目录；为 null 表示未按目录过滤</summary>
            public string FilterDirectory { get; set; }
        }

        /// <summary>
        /// 列出历史会话
        /// </summary>
        /// <param name="onlyCurrentProject">true 表示只返回当前解决方案目录下的会话</param>
        public async Task<SessionListResult> ListSessionsAsync(bool onlyCurrentProject = true, int limit = 50)
        {
            var workingDir = await GetWorkingDirectoryAsync();
            var bridge = ClaudeAgentBridge.Instance;

            // 列表功能需要服务进程已启动；InitializeAsync 幂等，重复调用无副作用
            if (!await bridge.InitializeAsync(workingDir))
            {
                throw new Exception("Failed to initialize Claude Agent Bridge");
            }

            if (onlyCurrentProject && string.IsNullOrEmpty(workingDir))
            {
                // 拿不到目录时不静默返回全部，交由界面提示用户切换到「全部」
                throw new Exception("未能确定当前项目目录，请切换到「全部」查看会话");
            }

            var sessions = await bridge.ListSessionsAsync(
                limit,
                allProjects: !onlyCurrentProject,
                cwd: onlyCurrentProject ? workingDir : null);

            return new SessionListResult
            {
                Sessions = sessions,
                FilterDirectory = onlyCurrentProject ? workingDir : null
            };
        }

        /// <summary>
        /// 删除指定历史会话
        /// </summary>
        public async Task<bool> DeleteSessionAsync(string sessionId)
        {
            if (string.IsNullOrEmpty(sessionId))
            {
                return false;
            }

            var workingDir = await GetWorkingDirectoryAsync();
            var bridge = ClaudeAgentBridge.Instance;

            if (!await bridge.InitializeAsync(workingDir))
            {
                throw new Exception("Failed to initialize Claude Agent Bridge");
            }

            var deleted = await bridge.DeleteSessionAsync(sessionId);

            // 删除的正是当前会话时，同步清空界面，避免继续往已删除的会话追加内容
            if (deleted && string.Equals(sessionId, _currentSessionId, StringComparison.OrdinalIgnoreCase))
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                NewSession();
            }

            LogService.Info($"[Session] Delete {sessionId}: {deleted}");
            return deleted;
        }

        /// <summary>
        /// 加载历史会话并继续对话
        /// 会把历史消息回填到聊天界面，并把会话 ID 设为该会话，
        /// 之后提问会通过 SDK 的 resume 机制接续原有上下文
        /// </summary>
        public async Task<bool> LoadSessionAsync(string sessionId)
        {
            if (string.IsNullOrEmpty(sessionId))
            {
                return false;
            }

            if (IsRunning)
            {
                LogService.Warn("[Session] Cannot switch session while running");
                return false;
            }

            var workingDir = await GetWorkingDirectoryAsync();
            var bridge = ClaudeAgentBridge.Instance;

            if (!await bridge.InitializeAsync(workingDir))
            {
                throw new Exception("Failed to initialize Claude Agent Bridge");
            }

            var history = await bridge.GetSessionHistoryAsync(sessionId);

            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

            _updateTimer.Stop();
            while (_pendingContent.TryDequeue(out _)) { }
            _currentAssistantMessage = null;
            Messages.Clear();

            foreach (var item in history)
            {
                var role = item["role"]?.Value<string>();
                var content = item["content"]?.Value<string>() ?? string.Empty;
                if (string.IsNullOrEmpty(role))
                {
                    continue;
                }

                // 统一首字母大写，与实时对话写入的角色保持一致
                var normalizedRole = string.Equals(role, "user", StringComparison.OrdinalIgnoreCase)
                    ? "User"
                    : "Assistant";

                Messages.Add(new ChatMessage(normalizedRole, content));
            }

            _currentSessionId = sessionId;
            LogService.Info($"[Session] Loaded {sessionId} with {history.Count} messages");
            return true;
        }

        private async void OnCancel(object parameter)
        {
            if (CanCancel(parameter))
            {
                _cts?.Cancel();

                // 取消 Agent Bridge 的查询
                try
                {
                    await ClaudeAgentBridge.Instance.CancelAsync("User cancelled");
                }
                catch (Exception ex)
                {
                    LogService.Warn("Failed to cancel Agent Bridge query", ex);
                }
            }
        }

        public event PropertyChangedEventHandler PropertyChanged;

        protected virtual void OnPropertyChanged(string propertyName)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }
    }

    public class RelayCommand : ICommand
    {
        private readonly Action<object> _execute;
        private readonly Func<object, bool> _canExecute;

        public RelayCommand(Action<object> execute, Func<object, bool> canExecute = null)
        {
            _execute = execute ?? throw new ArgumentNullException(nameof(execute));
            _canExecute = canExecute;
        }

        public event EventHandler CanExecuteChanged;

        public bool CanExecute(object parameter)
        {
            return _canExecute == null || _canExecute(parameter);
        }

        public void Execute(object parameter)
        {
            _execute(parameter);
        }

        public void RaiseCanExecuteChanged()
        {
            CanExecuteChanged?.Invoke(this, EventArgs.Empty);
        }
    }
}