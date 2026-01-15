using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Serilog;

namespace ClaudeCodeForVS.Services
{
    public static class LogService
    {
        private static ILogger _logger;
        private static int _initialized = 0; // 使用原子操作代替 lock / Use atomic ops instead of lock

        /// <summary>
        /// 检测是否在调试模式下运行 / Check whether running in debug mode.
        /// </summary>
        private static bool IsDebugMode()
        {
#if DEBUG
            return true;
#else
            // 也检查是否有调试器附加 / Also check for an attached debugger
            return Debugger.IsAttached;
#endif
        }

        public static void Initialize()
        {
            // 使用原子操作防止重复初始化，避免 lock 导致调试时死锁 / Avoid duplicate init with atomics
            if (Interlocked.CompareExchange(ref _initialized, 1, 0) != 0)
                return;

            try
            {
                string appDataPath = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string logFolder = Path.Combine(appDataPath, "ClaudeCodeForVS", "Logs");

                if (!Directory.Exists(logFolder))
                {
                    Directory.CreateDirectory(logFolder);
                }

                // 根据运行模式使用不同的日志文件名 / Use different log file names by mode
                // Debug 模式: claude-code-debug.log / Debug mode
                // Release 模式: claude-code-20260106.log / Release mode
                bool isDebug = IsDebugMode();
                string filePrefix = isDebug ? "claude-code-debug" : "claude-code-";
                string logFile = Path.Combine(logFolder, filePrefix + ".log");

                // DEBUG 模式下，启动时清空日志文件 / Clear log file on startup in DEBUG mode
                if (isDebug)
                {
                    try
                    {
                        // 删除旧的 debug 日志文件
                        if (File.Exists(logFile))
                        {
                            File.Delete(logFile);
                        }
                        // 也删除带日期后缀的旧文件
                        foreach (var oldFile in Directory.GetFiles(logFolder, "claude-code-debug*.log"))
                        {
                            try { File.Delete(oldFile); } catch { }
                        }
                    }
                    catch { /* 忽略删除失败 */ }
                }

                // DEBUG 模式使用 Debug 级别，Release 使用 Information 级别
                var logConfig = new LoggerConfiguration();
                if (isDebug)
                {
                    logConfig = logConfig.MinimumLevel.Debug();
                }
                else
                {
                    logConfig = logConfig.MinimumLevel.Information();
                }

                _logger = logConfig
                    .WriteTo.File(logFile,
                        rollingInterval: isDebug ? RollingInterval.Infinite : RollingInterval.Day, // Debug 不滚动
                        retainedFileCountLimit: 7,
                        fileSizeLimitBytes: 10 * 1024 * 1024, // 10 MB 每个文件 / 10 MB per file
                        rollOnFileSizeLimit: false, // 不按大小滚动，只按天滚动 / Daily rolling only
                        shared: true, // 允许多进程共享文件 / Allow multi-process sharing
                        outputTemplate: "{Timestamp:HH:mm:ss.fff} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
                    .CreateLogger();

                // 同时设置 Serilog 的静态 Log 实例，以便正确调用 CloseAndFlush / Set Serilog Log singleton
                Log.Logger = _logger;

                _logger.Information($"=== Claude Code for VS Started ({(isDebug ? "DEBUG" : "Release")}) ===");
            }
            catch (Exception ex)
            {
                // Fallback if logging fails to initialize / 日志初始化失败时的回退
                System.Diagnostics.Debug.WriteLine($"Failed to initialize logger: {ex}");
            }
        }

        // Serilog 的 ILogger 实现本身是线程安全的，无需额外加锁 / Serilog ILogger is thread-safe
        public static void Info(string message)
        {
            _logger?.Information(message);
        }

        public static void Debug(string message)
        {
            _logger?.Debug(message);
        }

        public static void Warn(string message, Exception ex = null)
        {
            if (ex != null)
            {
                _logger?.Warning(ex, message);
            }
            else
            {
                _logger?.Warning(message);
            }
        }

        public static void Error(string message, Exception ex = null)
        {
            if (ex != null)
            {
                _logger?.Error(ex, message);
            }
            else
            {
                _logger?.Error(message);
            }
        }

        public static void CloseAndFlush()
        {
            // 正确调用 Serilog 的 CloseAndFlush / Properly call Serilog CloseAndFlush
            Log.CloseAndFlush();
        }
    }
}
