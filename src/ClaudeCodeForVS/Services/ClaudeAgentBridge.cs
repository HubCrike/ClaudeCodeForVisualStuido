using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ClaudeCodeForVS.Services
{
    /// <summary>
    /// Claude Agent SDK 桥接服务
    /// 管理 Node.js 子进程，通过 JSON-RPC 2.0 风格的 IPC 与 TypeScript SDK 通信
    /// </summary>
    public class ClaudeAgentBridge : IDisposable
    {
        public static readonly Guid ClaudeCodePaneGuid = new Guid("A8F925EA-4515-4BBA-92E3-BB69C995AEEC");

        private static readonly Lazy<ClaudeAgentBridge> _instance = new Lazy<ClaudeAgentBridge>(() => new ClaudeAgentBridge());
        public static ClaudeAgentBridge Instance => _instance.Value;

        private static readonly TimeSpan DefaultRequestTimeout = TimeSpan.FromMinutes(10);
        private static readonly TimeSpan InitializeTimeout = TimeSpan.FromSeconds(30);

        private readonly SemaphoreSlim _processLock = new SemaphoreSlim(1, 1);
        private readonly ConcurrentDictionary<string, TaskCompletionSource<JObject>> _pendingRequests = new ConcurrentDictionary<string, TaskCompletionSource<JObject>>();

        private Process _process;
        private StreamWriter _stdin;
        private StreamReader _stdout;
        private StreamReader _stderr;
        private Task _stdoutPumpTask;
        private Task _stderrPumpTask;
        private CancellationTokenSource _processCts;
        private string _workingDirectory;
        private bool _initialized;
        private bool _disposed;
        private int _requestIdCounter;

        /// <summary>
        /// 当收到 Agent 事件时触发
        /// </summary>
        public event Action<JObject> OnAgentEvent;

        /// <summary>
        /// 当收到权限请求时触发
        /// </summary>
        public event Action<JObject> OnPermissionRequest;

        /// <summary>
        /// 当收到日志消息时触发
        /// </summary>
        public event Action<string> OnLogMessage;

        private ClaudeAgentBridge()
        {
        }

        /// <summary>
        /// 初始化桥接服务
        /// </summary>
        public async Task<bool> InitializeAsync(string workingDirectory, CancellationToken ct = default)
        {
            ThrowIfDisposed();

            await _processLock.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                if (_initialized && _process != null && !_process.HasExited)
                {
                    if (string.Equals(_workingDirectory, workingDirectory, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                    // 工作目录改变，需要重启进程
                    await StopProcessAsync().ConfigureAwait(false);
                }

                _workingDirectory = workingDirectory;
                await StartProcessAsync(ct).ConfigureAwait(false);

                // 发送初始化请求
                using (var timeoutCts = new CancellationTokenSource(InitializeTimeout))
                using (var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token))
                {
                    var response = await SendRequestAsync("initialize", new
                    {
                        workingDirectory = _workingDirectory
                    }, linkedCts.Token).ConfigureAwait(false);

                    _initialized = response["result"]?["success"]?.Value<bool>() == true;
                    var version = response["result"]?["version"]?.Value<string>();
                    LogService.Info($"[Bridge] Initialized: success={_initialized}, version={version}");

                    return _initialized;
                }
            }
            catch (Exception ex)
            {
                LogService.Error("[Bridge] Initialize failed", ex);
                await StopProcessAsync().ConfigureAwait(false);
                // 抛出异常以便调用者获取详细信息
                throw new Exception($"ClaudeAgentBridge initialization failed: {ex.Message}", ex);
            }
            finally
            {
                _processLock.Release();
            }
        }

        /// <summary>
        /// 执行 Ping 测试
        /// </summary>
        public async Task<bool> PingAsync(CancellationToken ct = default)
        {
            ThrowIfDisposed();

            if (_process == null || _process.HasExited)
            {
                return false;
            }

            try
            {
                var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var response = await SendRequestAsync("ping", new { timestamp }, ct).ConfigureAwait(false);

                var serverTimestamp = response["result"]?["serverTimestamp"]?.Value<long>() ?? 0;
                var roundTrip = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - timestamp;

                LogService.Debug($"[Bridge] Ping: roundTrip={roundTrip}ms");
                return true;
            }
            catch (Exception ex)
            {
                LogService.Warn($"[Bridge] Ping failed: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// 发送查询请求
        /// </summary>
        public async Task<JObject> QueryAsync(string prompt, string sessionId = null, CancellationToken ct = default)
        {
            ThrowIfDisposed();

            if (!_initialized || _process == null || _process.HasExited)
            {
                throw new InvalidOperationException("Service not initialized");
            }

            using (var timeoutCts = new CancellationTokenSource(DefaultRequestTimeout))
            using (var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token))
            {
                var response = await SendRequestAsync("query", new
                {
                    prompt,
                    sessionId
                }, linkedCts.Token).ConfigureAwait(false);

                return response;
            }
        }

        /// <summary>
        /// 取消当前查询
        /// </summary>
        public async Task CancelAsync(string reason = null, CancellationToken ct = default)
        {
            ThrowIfDisposed();

            if (_process == null || _process.HasExited)
            {
                return;
            }

            try
            {
                await SendRequestAsync("cancel", new { reason }, ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                LogService.Warn($"[Bridge] Cancel failed: {ex.Message}");
            }
        }

        /// <summary>
        /// 响应权限请求
        /// </summary>
        public async Task RespondToPermissionAsync(string requestId, string decision, string reason = null, CancellationToken ct = default)
        {
            ThrowIfDisposed();

            if (_process == null || _process.HasExited)
            {
                throw new InvalidOperationException("Process not running");
            }

            await SendRequestAsync("permission.response", new
            {
                requestId,
                decision,
                reason
            }, ct).ConfigureAwait(false);
        }

        /// <summary>
        /// 列出可用的会话
        /// </summary>
        /// <param name="limit">最多返回条数</param>
        /// <param name="allProjects">true 表示跨项目返回全部会话</param>
        /// <param name="cwd">按此工作目录过滤，仅在 allProjects 为 false 时生效；为空则由服务端使用当前工作目录</param>
        public async Task<JArray> ListSessionsAsync(int? limit = null, bool allProjects = false, string cwd = null, CancellationToken ct = default)
        {
            ThrowIfDisposed();

            if (!_initialized || _process == null || _process.HasExited)
            {
                throw new InvalidOperationException("Service not initialized");
            }

            var response = await SendRequestAsync("sessions.list", new
            {
                limit,
                allProjects,
                cwd
            }, ct).ConfigureAwait(false);

            return response["result"]?["sessions"] as JArray ?? new JArray();
        }

        /// <summary>
        /// 删除指定会话
        /// </summary>
        public async Task<bool> DeleteSessionAsync(string sessionId, CancellationToken ct = default)
        {
            ThrowIfDisposed();

            if (!_initialized || _process == null || _process.HasExited)
            {
                throw new InvalidOperationException("Service not initialized");
            }

            var response = await SendRequestAsync("sessions.delete", new
            {
                sessionId
            }, ct).ConfigureAwait(false);

            return response["result"]?["deleted"]?.Value<bool>() ?? false;
        }

        /// <summary>
        /// 读取指定会话的历史消息
        /// </summary>
        public async Task<JArray> GetSessionHistoryAsync(string sessionId, CancellationToken ct = default)
        {
            ThrowIfDisposed();

            if (!_initialized || _process == null || _process.HasExited)
            {
                throw new InvalidOperationException("Service not initialized");
            }

            var response = await SendRequestAsync("sessions.history", new
            {
                sessionId
            }, ct).ConfigureAwait(false);

            return response["result"]?["messages"] as JArray ?? new JArray();
        }

        /// <summary>
        /// 恢复会话
        /// </summary>
        public async Task<JObject> ResumeSessionAsync(string sessionId, string prompt = null, CancellationToken ct = default)
        {
            ThrowIfDisposed();

            if (!_initialized || _process == null || _process.HasExited)
            {
                throw new InvalidOperationException("Service not initialized");
            }

            using (var timeoutCts = new CancellationTokenSource(DefaultRequestTimeout))
            using (var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token))
            {
                var response = await SendRequestAsync("sessions.resume", new
                {
                    sessionId,
                    prompt
                }, linkedCts.Token).ConfigureAwait(false);

                return response;
            }
        }

        /// <summary>
        /// 关闭服务
        /// </summary>
        public async Task ShutdownAsync(CancellationToken ct = default)
        {
            if (_process == null || _process.HasExited)
            {
                return;
            }

            try
            {
                await SendRequestAsync("shutdown", new { }, ct).ConfigureAwait(false);
            }
            catch
            {
                // 忽略关闭时的错误
            }

            await StopProcessAsync().ConfigureAwait(false);
        }

        private async Task StartProcessAsync(CancellationToken ct)
        {
            var scriptPath = GetBundledScriptPath();
            var nodeExe = FindNodeExecutable();

            if (!File.Exists(scriptPath))
            {
                throw new FileNotFoundException($"Claude Agent Service script not found: {scriptPath}");
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = $"\"{scriptPath}\"",
                WorkingDirectory = _workingDirectory,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            // 设置环境变量
            startInfo.EnvironmentVariables["LOG_LEVEL"] = "info";

            try
            {
                // 设置专用临时目录，防止污染用户项目目录 / Set dedicated temp dir to avoid polluting project dir
                // 这解决了 claude-code 可能在 CWD 生成 -cwd 临时文件的问题
                var tempDir = Path.Combine(_workingDirectory, ".claude", "temp");
                if (!Directory.Exists(tempDir))
                {
                    Directory.CreateDirectory(tempDir);
                }
                startInfo.EnvironmentVariables["TEMP"] = tempDir;
                startInfo.EnvironmentVariables["TMP"] = tempDir;
                startInfo.EnvironmentVariables["TMPDIR"] = tempDir;
                LogService.Debug($"[Bridge] Set TEMP/TMP/TMPDIR to: {tempDir}");
            }
            catch (Exception ex)
            {
                LogService.Warn($"[Bridge] Failed to set custom temp directory: {ex.Message}");
            }

            _processCts = new CancellationTokenSource();
            _process = new Process { StartInfo = startInfo };

            LogService.Info($"[Bridge] Starting Node.js: {startInfo.FileName}");

            try
            {
                _process.Start();
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                throw new Exception($"Failed to start Node.js process. Ensure Node.js is installed. Details: {ex.Message}");
            }

            _stdin = new StreamWriter(_process.StandardInput.BaseStream, new UTF8Encoding(false)) { AutoFlush = true };
            _stdout = _process.StandardOutput;
            _stderr = _process.StandardError;

            // 启动输出泵
            _stdoutPumpTask = PumpStdoutAsync(_processCts.Token);
            _stderrPumpTask = PumpStderrAsync(_processCts.Token);

            LogService.Info($"[Bridge] Node.js started, PID={_process.Id}");
        }

        private async Task PumpStdoutAsync(CancellationToken ct)
        {
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    var line = await _stdout.ReadLineAsync().ConfigureAwait(false);
                    if (line == null) break;
                    if (string.IsNullOrWhiteSpace(line)) continue;

                    // 只在 DEBUG 时输出原始 stdout（太详细，正常运行不需要）
                    System.Diagnostics.Debug.WriteLine($"[Stdout] {line}");

                    try
                    {
                        var message = JObject.Parse(line);
                        HandleMessage(message);
                    }
                    catch (JsonException ex)
                    {
                        LogService.Warn($"[Bridge] JSON parse error: {ex.Message}");
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // 正常取消
            }
            catch (Exception ex)
            {
                LogService.Error("[Bridge] Stdout pump error", ex);
            }
        }

        private async Task PumpStderrAsync(CancellationToken ct)
        {
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    var line = await _stderr.ReadLineAsync().ConfigureAwait(false);
                    if (line == null) break;
                    if (string.IsNullOrWhiteSpace(line)) continue;

                    // 智能处理日志级别
                    if (line.Contains("[ERROR]"))
                    {
                        LogService.Error($"[Bridge Stderr] {line}");
                    }
                    else if (line.Contains("[WARN]"))
                    {
                        LogService.Warn($"[Bridge Stderr] {line}");
                    }
                    else
                    {
                        // INFO 和 DEBUG 级别只记录为 Debug，避免污染日志
                        LogService.Debug($"[Bridge Stderr] {line}");
                    }
                    
                    OnLogMessage?.Invoke(line);
                }
            }
            catch (OperationCanceledException)
            {
                // 正常取消
            }
            catch (Exception ex)
            {
                LogService.Error("[Bridge] Stderr pump error", ex);
            }
        }

        private void HandleMessage(JObject message)
        {
            var jsonrpc = message["jsonrpc"]?.Value<string>();
            if (jsonrpc != "2.0") return;

            // 检查是否是响应
            if (message.ContainsKey("id") && (message.ContainsKey("result") || message.ContainsKey("error")))
            {
                var id = message["id"]?.Value<string>();
                if (id != null && _pendingRequests.TryRemove(id, out var tcs))
                {
                    if (message.ContainsKey("error"))
                    {
                        var error = message["error"];
                        var errorMessage = error?["message"]?.Value<string>() ?? "Unknown error";
                        tcs.TrySetException(new Exception(errorMessage));
                    }
                    else
                    {
                        tcs.TrySetResult(message);
                    }
                }
                return;
            }

            // 检查是否是通知
            var method = message["method"]?.Value<string>();
            if (method != null)
            {
                switch (method)
                {
                    case "agent.event":
                        OnAgentEvent?.Invoke(message["params"] as JObject);
                        break;
                    case "permission.request":
                        OnPermissionRequest?.Invoke(message["params"] as JObject);
                        break;
                    case "log":
                        var logMessage = message["params"]?["message"]?.Value<string>();
                        if (logMessage != null)
                        {
                            OnLogMessage?.Invoke(logMessage);
                        }
                        break;
                }
            }
        }

        private async Task<JObject> SendRequestAsync(string method, object parameters, CancellationToken ct)
        {
            var id = Interlocked.Increment(ref _requestIdCounter).ToString();
            var request = new
            {
                jsonrpc = "2.0",
                id,
                method,
                @params = parameters
            };

            var tcs = new TaskCompletionSource<JObject>();
            _pendingRequests[id] = tcs;

            using (ct.Register(() => tcs.TrySetCanceled()))
            {
                var json = JsonConvert.SerializeObject(request);
                // 只记录方法名，不记录完整 JSON（太长）
                LogService.Debug($"[Bridge] Request: {method}");

                await _stdin.WriteLineAsync(json).ConfigureAwait(false);
                await _stdin.FlushAsync().ConfigureAwait(false);

                return await tcs.Task.ConfigureAwait(false);
            }
        }

        private async Task StopProcessAsync()
        {
            _initialized = false;

            // 取消所有待处理的请求
            foreach (var kvp in _pendingRequests)
            {
                kvp.Value.TrySetCanceled();
            }
            _pendingRequests.Clear();

            _processCts?.Cancel();

            try
            {
                if (_stdoutPumpTask != null)
                {
                    await Task.WhenAny(_stdoutPumpTask, Task.Delay(1000)).ConfigureAwait(false);
                }
                if (_stderrPumpTask != null)
                {
                    await Task.WhenAny(_stderrPumpTask, Task.Delay(1000)).ConfigureAwait(false);
                }
            }
            catch { }

            try
            {
                if (_process != null && !_process.HasExited)
                {
                    _process.Kill();
                    _process.WaitForExit(1000);
                }
            }
            catch (Exception ex)
            {
                LogService.Warn($"[Bridge] Failed to kill process: {ex.Message}");
            }
            finally
            {
                _stdin?.Dispose();
                _stdout?.Dispose();
                _stderr?.Dispose();
                _process?.Dispose();
                _processCts?.Dispose();

                _stdin = null;
                _stdout = null;
                _stderr = null;
                _process = null;
                _processCts = null;
                _stdoutPumpTask = null;
                _stderrPumpTask = null;
            }
        }

        /// <summary>
        /// 获取打包后的 Claude Agent Service 脚本路径
        /// </summary>
        private string GetBundledScriptPath()
        {
            // 获取当前程序集所在目录
            var assemblyLocation = typeof(ClaudeAgentBridge).Assembly.Location;
            var assemblyDir = Path.GetDirectoryName(assemblyLocation);

            var searchedPaths = new List<string>();

            // 1. 查找输出目录中的打包文件 (发布模式) - 与 frontend 一样在 wwwroot
            var bundledScript = Path.Combine(assemblyDir, "wwwroot", "claude-agent", "index.js");
            searchedPaths.Add(bundledScript);
            if (File.Exists(bundledScript))
            {
                LogService.Debug($"[Bridge] Found script: {bundledScript}");
                return bundledScript;
            }

            // 2. 开发模式：从源码目录查找
            var currentDir = assemblyDir;
            
            while (!string.IsNullOrEmpty(currentDir))
            {
                // 尝试 src/ClaudeCodeForVS/wwwroot/claude-agent/index.js
                bundledScript = Path.Combine(currentDir, "src", "ClaudeCodeForVS", "wwwroot", "claude-agent", "index.js");
                searchedPaths.Add(bundledScript);
                if (File.Exists(bundledScript))
                {
                    LogService.Debug($"[Bridge] Found script: {bundledScript}");
                    return bundledScript;
                }

                // 尝试 ClaudeCodeForVS/wwwroot/claude-agent/index.js (不带 src)
                bundledScript = Path.Combine(currentDir, "ClaudeCodeForVS", "wwwroot", "claude-agent", "index.js");
                searchedPaths.Add(bundledScript);
                if (File.Exists(bundledScript))
                {
                    LogService.Debug($"[Bridge] Found script: {bundledScript}");
                    return bundledScript;
                }

                // 尝试 wwwroot/claude-agent/index.js
                bundledScript = Path.Combine(currentDir, "wwwroot", "claude-agent", "index.js");
                searchedPaths.Add(bundledScript);
                if (File.Exists(bundledScript))
                {
                    LogService.Debug($"[Bridge] Found script: {bundledScript}");
                    return bundledScript;
                }

                currentDir = Path.GetDirectoryName(currentDir);
            }

            LogService.Error($"[Bridge] Script not found. Tried: {string.Join(", ", searchedPaths.Distinct().Take(5))}");

            throw new FileNotFoundException("Claude Agent Service bundled script not found. Run 'pnpm run build' in claude-agent-service directory.");
        }

        private string FindNodeExecutable()
        {
            var nodeExe = WindowsCommandResolver.Resolve("node");
            if (File.Exists(nodeExe))
            {
                return nodeExe;
            }
            return "node";
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(nameof(ClaudeAgentBridge));
            }
        }

        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        protected virtual void Dispose(bool disposing)
        {
            if (_disposed)
                return;

            if (disposing)
            {
                StopProcessAsync().GetAwaiter().GetResult();
                _processLock?.Dispose();
            }

            _disposed = true;
        }

        ~ClaudeAgentBridge()
        {
            Dispose(false);
        }
    }
}
