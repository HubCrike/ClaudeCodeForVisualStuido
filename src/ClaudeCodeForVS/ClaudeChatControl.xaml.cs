using ClaudeCodeForVS.Models;
using ClaudeCodeForVS.Services;
using ClaudeCodeForVS.ViewModels;
using Microsoft.VisualStudio.PlatformUI;
using Microsoft.VisualStudio.Shell;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Specialized;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;

namespace ClaudeCodeForVS
{
    public partial class ClaudeChatControl : UserControl
    {
        private readonly ChatViewModel _viewModel;
        private bool _initialized;

        public ClaudeChatControl()
        {
            try
            {
                LogService.Debug("ClaudeChatControl constructor started");
                InitializeComponent();
                LogService.Debug("XAML components initialized");

                _viewModel = new ChatViewModel();
                LogService.Debug("ChatViewModel created");

                Loaded += OnLoaded;
                Unloaded += OnUnloaded;
                VSColorTheme.ThemeChanged += OnThemeChanged;
                LogService.Debug("ClaudeChatControl constructor completed");
            }
            catch (Exception ex)
            {
                LogService.Error("Failed to initialize ClaudeChatControl", ex);
                throw;
            }
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            try
            {
                if (!_initialized)
                {
                    _initialized = true;
                    await InitializeWebViewAsync();
                    // Theme will be applied when NavigationCompleted event fires / 主题将在 NavigationCompleted 触发时应用
                }
                else
                {
                    // Re-subscribe to WebView events if they were unsubscribed in OnUnloaded / 重新订阅 OnUnloaded 中取消的事件
                    if (Browser?.CoreWebView2 != null)
                    {
                        Browser.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
                        Browser.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                        Browser.CoreWebView2.NavigationCompleted -= OnNavigationCompleted;
                        Browser.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
                    }
                }

                // Ensure we handle theme changes / 确保处理主题变化
                VSColorTheme.ThemeChanged -= OnThemeChanged;
                VSColorTheme.ThemeChanged += OnThemeChanged;

                // Ensure we are hooked to the view model / 确保已绑定 ViewModel
                UnhookViewModel();
                HookViewModel();

                await PushFullStateAsync();
            }
            catch (Exception ex)
            {
                LogService.Error("[OnLoaded] Failed to initialize control", ex);
            }
        }

        private void OnUnloaded(object sender, RoutedEventArgs e)
        {
            UnhookViewModel();
            VSColorTheme.ThemeChanged -= OnThemeChanged;

            try
            {
                if (Browser?.CoreWebView2 != null)
                {
                    Browser.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
                    Browser.CoreWebView2.NavigationCompleted -= OnNavigationCompleted;
                }
            }
            catch (Exception ex)
            {
                LogService.Error("[OnUnloaded] WebView2 teardown error", ex);
            }
        }

        private void HookViewModel()
        {
            _viewModel.Messages.CollectionChanged += OnMessagesCollectionChanged;
            _viewModel.PropertyChanged += OnViewModelPropertyChanged;
            _viewModel.OnPermissionRequest += OnViewModelPermissionRequest;

            foreach (var message in _viewModel.Messages)
            {
                HookMessage(message);
            }
        }

        private void UnhookViewModel()
        {
            _viewModel.Messages.CollectionChanged -= OnMessagesCollectionChanged;
            _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
            _viewModel.OnPermissionRequest -= OnViewModelPermissionRequest;

            foreach (var message in _viewModel.Messages)
            {
                UnhookMessage(message);
            }
        }

        private void OnViewModelPermissionRequest(string requestId, string toolName, object toolInput, string description, string risk)
        {
            _ = SendPermissionRequestAsync(requestId, toolName, toolInput, description, risk);
        }

        private void HookMessage(ChatMessage message)
        {
            if (message == null)
                return;
            message.PropertyChanged += OnMessagePropertyChanged;
        }

        private void UnhookMessage(ChatMessage message)
        {
            if (message == null)
                return;
            message.PropertyChanged -= OnMessagePropertyChanged;
        }

        private async Task InitializeWebViewAsync()
        {
            try
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string userDataFolder = Path.Combine(localAppData, "ClaudeCodeForVS", "WebView2");
                Directory.CreateDirectory(userDataFolder);

                CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(
                    browserExecutableFolder: null,
                    userDataFolder: userDataFolder);

                await Browser.EnsureCoreWebView2Async(environment);

                if (Browser.CoreWebView2 == null)
                {
                    ShowFallback(
                        "WebView2 init failed\n\n" +
                        "CoreWebView2 is null after EnsureCoreWebView2Async.\n\n" +
                        "UserDataFolder:\n" + userDataFolder);
                    return;
                }

                Browser.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                Browser.CoreWebView2.NavigationCompleted += OnNavigationCompleted;

                string assemblyDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                string wwwrootDir = Path.Combine(assemblyDir, "wwwroot");

                if (!Directory.Exists(wwwrootDir))
                {
                    ShowFallback(
                        "wwwroot not found\n\n" +
                        "Expected folder:\n" + wwwrootDir + "\n\n" +
                        "Ensure wwwroot is included in the VSIX and copied to output.");
                    return;
                }

                // Use a virtual host mapping instead of file:// to avoid local file access restrictions. / 使用虚拟主机映射代替 file://，避免本地文件访问限制。
                Browser.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "app",
                    wwwrootDir,
                    CoreWebView2HostResourceAccessKind.Allow);

                Browser.CoreWebView2.Navigate("https://app/index.html");
            }
            catch (Exception ex)
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string userDataFolder = Path.Combine(localAppData, "ClaudeCodeForVS", "WebView2");
                ShowFallback(
                    "WebView2 init failed\n\n" +
                    "UserDataFolder:\n" + userDataFolder + "\n\n",
                    ex);
            }
        }

        private void ShowFallback(string message)
        {
            try
            {
                Browser.Visibility = Visibility.Collapsed;
                Fallback.Visibility = Visibility.Visible;
                FallbackText.Text = message ?? string.Empty;
            }
            catch (Exception ex)
            {
                LogService.Error("[ShowFallback] Failed to show fallback UI", ex);
            }
        }

        private void ShowFallback(string title, Exception ex)
        {
            string text = title;
            if (ex != null)
            {
                text += ex.ToString();
            }
            ShowFallback(text);
        }

        private async void OnMessagesCollectionChanged(object sender, NotifyCollectionChangedEventArgs e)
        {
            try
            {
                if (e.NewItems != null)
                {
                    foreach (var item in e.NewItems.OfType<ChatMessage>())
                    {
                        HookMessage(item);
                    }
                }

                if (e.OldItems != null)
                {
                    foreach (var item in e.OldItems.OfType<ChatMessage>())
                    {
                        UnhookMessage(item);
                    }
                }

                await PushFullStateAsync();
            }
            catch (Exception ex)
            {
                LogService.Error("[OnMessagesCollectionChanged] Error handling collection change", ex);
            }
        }

        private async void OnMessagePropertyChanged(object sender, PropertyChangedEventArgs e)
        {
            try
            {
                if (string.Equals(e.PropertyName, nameof(ChatMessage.Content), StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(e.PropertyName, nameof(ChatMessage.Role), StringComparison.OrdinalIgnoreCase))
                {
                    await PushFullStateAsync();
                }
            }
            catch (Exception ex)
            {
                LogService.Error("[OnMessagePropertyChanged] Error handling property change", ex);
            }
        }

        private async void OnViewModelPropertyChanged(object sender, PropertyChangedEventArgs e)
        {
            try
            {
                if (string.Equals(e.PropertyName, nameof(ChatViewModel.IsRunning), StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(e.PropertyName, nameof(ChatViewModel.UserInput), StringComparison.OrdinalIgnoreCase))
                {
                    await PushFullStateAsync();
                }
            }
            catch (Exception ex)
            {
                LogService.Error("[OnViewModelPropertyChanged] Error handling property change", ex);
            }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var json = e.WebMessageAsJson;
                if (string.IsNullOrWhiteSpace(json))
                    return;

                var msg = JObject.Parse(json);
                var type = msg.Value<string>("type");

                if (string.Equals(type, "run", StringComparison.OrdinalIgnoreCase))
                {
                    var text = msg.Value<string>("text") ?? string.Empty;
                    _viewModel.UserInput = text;

                    if (_viewModel.RunCommand.CanExecute(null))
                    {
                        _viewModel.RunCommand.Execute(null);
                    }
                    return;
                }

                if (string.Equals(type, "cancel", StringComparison.OrdinalIgnoreCase))
                {
                    if (_viewModel.CancelCommand.CanExecute(null))
                    {
                        _viewModel.CancelCommand.Execute(null);
                    }
                    return;
                }

                if (string.Equals(type, "requestState", StringComparison.OrdinalIgnoreCase))
                {
                    _ = PushFullStateAsync();
                    return;
                }

                if (string.Equals(type, "getEditorContext", StringComparison.OrdinalIgnoreCase))
                {
                    _ = SendEditorContextAsync();
                    return;
                }

                if (string.Equals(type, "getProjectFiles", StringComparison.OrdinalIgnoreCase))
                {
                    _ = SendProjectFilesAsync();
                    return;
                }

                // 处理权限响应
                if (string.Equals(type, "permissionResponse", StringComparison.OrdinalIgnoreCase))
                {
                    var requestId = msg.Value<string>("requestId");
                    var decision = msg.Value<string>("decision");
                    var reason = msg.Value<string>("reason");
                    _ = HandlePermissionResponseAsync(requestId, decision, reason);
                    return;
                }

                // 新建会话
                if (string.Equals(type, "newSession", StringComparison.OrdinalIgnoreCase))
                {
                    _viewModel.NewSession();
                    _ = PushFullStateAsync();
                    return;
                }

                // 获取历史会话列表
                if (string.Equals(type, "listSessions", StringComparison.OrdinalIgnoreCase))
                {
                    // 默认只看当前解决方案的会话；前端可传 onlyCurrentProject=false 查看全部
                    var onlyCurrent = msg.Value<bool?>("onlyCurrentProject") ?? true;
                    _ = SendSessionsAsync(onlyCurrent);
                    return;
                }

                // 加载并继续某个历史会话
                if (string.Equals(type, "loadSession", StringComparison.OrdinalIgnoreCase))
                {
                    var sessionId = msg.Value<string>("sessionId");
                    _ = LoadSessionAsync(sessionId);
                    return;
                }

                // 删除历史会话
                if (string.Equals(type, "deleteSession", StringComparison.OrdinalIgnoreCase))
                {
                    var sessionId = msg.Value<string>("sessionId");
                    var onlyCurrent = msg.Value<bool?>("onlyCurrentProject") ?? true;
                    _ = DeleteSessionAsync(sessionId, onlyCurrent);
                    return;
                }
            }
            catch (Exception ex)
            {
                LogService.Error("[OnWebMessageReceived] Failed to process message", ex);
            }
        }

        private Task PushFullStateAsync()
        {
            try
            {
                if (Browser?.CoreWebView2 == null)
                {
                    return Task.CompletedTask;
                }

                var payload = new
                {
                    type = "state",
                    isRunning = _viewModel.IsRunning,
                    currentSessionId = _viewModel.CurrentSessionId,
                    messages = _viewModel.Messages.Select(m => new
                    {
                        role = m.Role,
                        content = m.Content
                    }).ToArray()
                };

                var json = JsonConvert.SerializeObject(payload);
                Browser.CoreWebView2.PostWebMessageAsJson(json);
            }
            catch (Exception ex)
            {
                LogService.Error("[PushFullStateAsync] Failed to push state", ex);
            }

            return Task.CompletedTask;
        }

        /// <summary>
        /// 查询历史会话列表并推送给前端
        /// </summary>
        private async Task SendSessionsAsync(bool onlyCurrentProject)
        {
            try
            {
                var result = await _viewModel.ListSessionsAsync(onlyCurrentProject);
                var sessions = result.Sessions;

                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

                if (Browser?.CoreWebView2 == null)
                    return;

                var payload = new
                {
                    type = "sessions",
                    onlyCurrentProject,
                    currentSessionId = _viewModel.CurrentSessionId,
                    filterDirectory = result.FilterDirectory,
                    sessions = sessions.Select(s => new
                    {
                        sessionId = s["sessionId"]?.Value<string>(),
                        title = s["title"]?.Value<string>(),
                        cwd = s["cwd"]?.Value<string>(),
                        messageCount = s["messageCount"]?.Value<int>() ?? 0,
                        createdAt = s["createdAt"]?.Value<long>() ?? 0L,
                        lastUpdatedAt = s["lastUpdatedAt"]?.Value<long>() ?? 0L
                    }).ToArray()
                };

                Browser.CoreWebView2.PostWebMessageAsJson(JsonConvert.SerializeObject(payload));
            }
            catch (Exception ex)
            {
                LogService.Error("[SendSessionsAsync] Failed to list sessions", ex);
                await SendSessionErrorAsync(ex.Message);
            }
        }

        /// <summary>
        /// 加载并继续指定历史会话
        /// </summary>
        private async Task LoadSessionAsync(string sessionId)
        {
            try
            {
                var loaded = await _viewModel.LoadSessionAsync(sessionId);

                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

                if (!loaded)
                {
                    await SendSessionErrorAsync("无法加载会话，请先等待当前回答结束");
                    return;
                }

                await PushFullStateAsync();
            }
            catch (Exception ex)
            {
                LogService.Error("[LoadSessionAsync] Failed to load session", ex);
                await SendSessionErrorAsync("加载会话失败: " + ex.Message);
            }
        }

        /// <summary>
        /// 删除指定历史会话，成功后刷新列表
        /// </summary>
        private async Task DeleteSessionAsync(string sessionId, bool onlyCurrentProject)
        {
            try
            {
                var wasCurrent = string.Equals(sessionId, _viewModel.CurrentSessionId, StringComparison.OrdinalIgnoreCase);
                var deleted = await _viewModel.DeleteSessionAsync(sessionId);

                if (!deleted)
                {
                    await SendSessionErrorAsync("删除会话失败");
                    return;
                }

                // 删除的是当前会话时，界面已被清空，需要同步状态
                if (wasCurrent)
                {
                    await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                    await PushFullStateAsync();
                }

                await SendSessionsAsync(onlyCurrentProject);
            }
            catch (Exception ex)
            {
                LogService.Error("[DeleteSessionAsync] Failed to delete session", ex);
                await SendSessionErrorAsync("删除会话失败: " + ex.Message);
            }
        }

        /// <summary>
        /// 向前端推送会话操作的错误提示
        /// </summary>
        private async Task SendSessionErrorAsync(string message)
        {
            try
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

                if (Browser?.CoreWebView2 == null)
                    return;

                var payload = new
                {
                    type = "sessionError",
                    message
                };

                Browser.CoreWebView2.PostWebMessageAsJson(JsonConvert.SerializeObject(payload));
            }
            catch (Exception ex)
            {
                LogService.Error("[SendSessionErrorAsync] Failed to push error", ex);
            }
        }

        private async Task SendEditorContextAsync()
        {
            try
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

                var context = EditorContextService.Instance.GetCurrentContext();

                if (Browser?.CoreWebView2 == null)
                    return;

                var payload = new
                {
                    type = "editorContext",
                    context = context != null ? new
                    {
                        filePath = context.FilePath,
                        fileName = context.FileName,
                        relativePath = context.RelativePath,
                        language = context.Language,
                        selectedText = context.SelectedText,
                        selectionStartLine = context.SelectionStartLine,
                        selectionEndLine = context.SelectionEndLine,
                        currentLine = context.CurrentLine,
                        hasSelection = context.HasSelection
                    } : null
                };

                var json = JsonConvert.SerializeObject(payload);
                await Browser.CoreWebView2.ExecuteScriptAsync($"window.postMessage({json}, '*');");
            }
            catch (Exception ex)
            {
                LogService.Error("[SendEditorContextAsync] Failed to send editor context", ex);
            }
        }

        private async Task SendProjectFilesAsync()
        {
            try
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

                var files = EditorContextService.Instance.GetProjectFiles();

                LogService.Debug($"[SendProjectFilesAsync] Found {files.Count} files");

                if (Browser?.CoreWebView2 == null)
                    return;

                var payload = new
                {
                    type = "projectFiles",
                    files = files.Select(f => new
                    {
                        name = f.Name,
                        path = f.Path,
                        directory = f.Directory
                    }).ToArray()
                };

                var json = JsonConvert.SerializeObject(payload);
                LogService.Debug($"[SendProjectFilesAsync] Sending message: {json.Substring(0, Math.Min(200, json.Length))}...");
                await Browser.CoreWebView2.ExecuteScriptAsync($"window.postMessage({json}, '*');");
            }
            catch (Exception ex)
            {
                LogService.Debug($"[SendProjectFilesAsync] Error: {ex.Message}");
            }
        }

        private async Task HandlePermissionResponseAsync(string requestId, string decision, string reason)
        {
            try
            {
                if (string.IsNullOrEmpty(requestId) || string.IsNullOrEmpty(decision))
                {
                    LogService.Warn("[HandlePermissionResponseAsync] Invalid permission response: missing requestId or decision");
                    return;
                }

                await ClaudeAgentBridge.Instance.RespondToPermissionAsync(requestId, decision, reason);
                LogService.Debug($"[HandlePermissionResponseAsync] Sent permission response: {requestId} = {decision}");
            }
            catch (Exception ex)
            {
                LogService.Error($"[HandlePermissionResponseAsync] Failed to send permission response", ex);
            }
        }

        /// <summary>
        /// 发送权限请求到前端
        /// </summary>
        internal async Task SendPermissionRequestAsync(string requestId, string toolName, object toolInput, string description, string risk)
        {
            try
            {
                // 确保在 UI 线程上执行 WebView2 操作
                await Dispatcher.InvokeAsync(async () =>
                {
                    try
                    {
                        if (Browser?.CoreWebView2 == null)
                            return;

                        var payload = new
                        {
                            type = "permissionRequest",
                            requestId,
                            toolName,
                            toolInput,
                            description,
                            risk
                        };

                        var json = JsonConvert.SerializeObject(payload);
                        LogService.Debug($"[SendPermissionRequestAsync] Sending permission request: {toolName}");
                        await Browser.CoreWebView2.ExecuteScriptAsync($"window.postMessage({json}, '*');");
                    }
                    catch (Exception ex)
                    {
                        LogService.Error("[SendPermissionRequestAsync] Failed to send permission request (inner)", ex);
                    }
                });
            }
            catch (Exception ex)
            {
                LogService.Error("[SendPermissionRequestAsync] Failed to send permission request", ex);
            }
        }

        private void OnThemeChanged(ThemeChangedEventArgs e)
        {
            _ = UpdateThemeAsync();
        }

        private async void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            try
            {
                if (e.IsSuccess)
                {
                    await UpdateThemeAsync();
                }
            }
            catch (Exception ex)
            {
                LogService.Error("[OnNavigationCompleted] Error handling navigation completion", ex);
            }
        }

        private async Task UpdateThemeAsync()
        {
            if (Browser?.CoreWebView2 == null)
                return;

            var css = GenerateThemeCss();

            var script = $@"
                (function() {{
                    let style = document.getElementById('vs-theme-style');
                    if (!style) {{
                        style = document.createElement('style');
                        style.id = 'vs-theme-style';
                        document.head.appendChild(style);
                    }}
                    style.textContent = `{css}`;
                }})();
            ";

            try
            {
                await Browser.CoreWebView2.ExecuteScriptAsync(script);
            }
            catch (Exception ex)
            {
                LogService.Error("[UpdateThemeAsync] Failed to execute theme script", ex);
            }
        }

        private static string GenerateThemeCss()
        {
            var sb = new StringBuilder();
            sb.AppendLine(":root {");

            // Editor colors / 编辑器颜色
            sb.AppendLine($"  --vscode-editor-background: {GetColor(EnvironmentColors.ToolWindowBackgroundColorKey)};");
            sb.AppendLine($"  --vscode-editor-foreground: {GetColor(EnvironmentColors.ToolWindowTextColorKey)};");
            sb.AppendLine($"  --vscode-sideBar-background: {GetColor(EnvironmentColors.ToolWindowBackgroundColorKey)};");

            // Borders / 边框
            sb.AppendLine($"  --vscode-panel-border: {GetColor(EnvironmentColors.ToolWindowBorderColorKey)};");
            sb.AppendLine($"  --vscode-widget-border: {GetColor(EnvironmentColors.ToolWindowBorderColorKey)};");
            sb.AppendLine($"  --vscode-focusBorder: {GetColor(EnvironmentColors.SystemHighlightColorKey)};");

            // Inputs / 输入框
            sb.AppendLine($"  --vscode-input-background: {GetColor(EnvironmentColors.ComboBoxBackgroundColorKey)};");
            sb.AppendLine($"  --vscode-input-foreground: {GetColor(EnvironmentColors.ComboBoxTextColorKey)};");
            sb.AppendLine($"  --vscode-input-border: {GetColor(EnvironmentColors.ComboBoxBorderColorKey)};");
            sb.AppendLine($"  --vscode-input-placeholderForeground: {GetColor(EnvironmentColors.SystemGrayTextColorKey)};");

            // Buttons / 按钮
            // Use SystemHighlight for primary action buttons to match VS Code style / 主按钮使用 SystemHighlight，以匹配 VS Code 风格
            sb.AppendLine($"  --vscode-button-background: {GetColor(EnvironmentColors.SystemHighlightColorKey)};");
            sb.AppendLine($"  --vscode-button-foreground: {GetColor(EnvironmentColors.SystemHighlightTextColorKey)};");
            // For hover, we don't have a perfect key, so we reuse the highlight color but rely on CSS opacity or brightness if needed. / 悬停色缺少精确键值，复用高亮色并用 CSS 调整透明度或亮度
            sb.AppendLine($"  --vscode-button-hoverBackground: {GetColor(EnvironmentColors.ComboBoxButtonMouseOverBackgroundColorKey)};");

            // Text / 文本
            sb.AppendLine($"  --vscode-descriptionForeground: {GetColor(EnvironmentColors.SystemGrayTextColorKey)};");

            // Determine if dark theme / 判断是否为深色主题
            var bgColor = VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowBackgroundColorKey);
            var isDark = (0.299 * bgColor.R + 0.587 * bgColor.G + 0.114 * bgColor.B) < 128;

            if (isDark)
            {
                sb.AppendLine("  --vscode-textLink-foreground: #3794ff;");
                sb.AppendLine("  --vscode-textPreformat-foreground: #d7ba7d;");
                sb.AppendLine("  --vscode-textBlockQuote-background: rgba(255, 255, 255, 0.1);");
                sb.AppendLine("  --vscode-textCodeBlock-background: #0a0a0a;");
                sb.AppendLine("  --vscode-badge-background: #4d4d4d;");
                sb.AppendLine("  --vscode-badge-foreground: #ffffff;");
                sb.AppendLine("  --vscode-icon-foreground: #c5c5c5;");
                sb.AppendLine("  --vscode-toolbar-hoverBackground: rgba(90, 93, 94, 0.31);");
                sb.AppendLine("  --vscode-button-secondaryBackground: #3a3d41;");
            }
            else
            {
                sb.AppendLine("  --vscode-textLink-foreground: #0066bf;");
                sb.AppendLine("  --vscode-textPreformat-foreground: #a31515;");
                sb.AppendLine("  --vscode-textBlockQuote-background: rgba(0, 0, 0, 0.05);");
                sb.AppendLine("  --vscode-textCodeBlock-background: #f3f3f3;");
                sb.AppendLine("  --vscode-badge-background: #c4c4c4;");
                sb.AppendLine("  --vscode-badge-foreground: #333333;");
                sb.AppendLine("  --vscode-icon-foreground: #424242;");
                sb.AppendLine("  --vscode-toolbar-hoverBackground: rgba(184, 184, 184, 0.31);");
                sb.AppendLine("  --vscode-button-secondaryBackground: #5f6a79;");
            }

            sb.AppendLine("}");
            return sb.ToString();

            string GetColor(ThemeResourceKey key)
            {
                try
                {
                    var color = VSColorTheme.GetThemedColor(key);
                    return $"#{color.R:X2}{color.G:X2}{color.B:X2}";
                }
                catch (Exception ex)
                {
                    LogService.Error($"[GenerateThemeCss] Failed to get color for key {key?.GetType().Name}", ex);
                    return "#000000";
                }
            }
        }
    }
}
