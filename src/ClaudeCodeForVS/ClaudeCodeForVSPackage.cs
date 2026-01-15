using Microsoft.VisualStudio.Shell;
using System;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.VisualStudio.Shell.Interop;
using ClaudeCodeForVS.Services;
using Task = System.Threading.Tasks.Task;
using EnvDTE80;

namespace ClaudeCodeForVS
{
    /// <summary>
    /// This is the class that implements the package exposed by this assembly. / 此类实现本程序集公开的 VS 包。
    /// </summary>
    /// <remarks>
    /// <para>
    /// The minimum requirement for a class to be considered a valid package for Visual Studio / 成为有效 VS 包的最小要求
    /// is to implement the IVsPackage interface and register itself with the shell. / 是实现 IVsPackage 并注册到 shell。
    /// This package uses the helper classes defined inside the Managed Package Framework (MPF) / 本包使用 MPF 中的辅助类
    /// to do it: it derives from the Package class that provides the implementation of the / 具体做法是继承 Package 并实现
    /// IVsPackage interface and uses the registration attributes defined in the framework to / IVsPackage 接口并用框架特性注册
    /// register itself and its components with the shell. These attributes tell the pkgdef creation / 注册包及其组件，这些特性告知 pkgdef 工具
    /// utility what data to put into .pkgdef file. / 写入 .pkgdef 的数据
    /// </para>
    /// <para>
    /// To get loaded into VS, the package must be referred by &lt;Asset Type="Microsoft.VisualStudio.VsPackage" ...&gt; in .vsixmanifest file. / 要在 VS 中加载，需在 .vsixmanifest 中通过该 Asset 引用包。
    /// </para>
    /// </remarks>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [Guid(ClaudeCodeForVSPackage.PackageGuidString)]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideToolWindow(typeof(ClaudeChatToolWindow), Style = VsDockStyle.Tabbed, Window = "3ae79031-e1bc-11d0-8f78-00a0c9110057")]
    public sealed class ClaudeCodeForVSPackage : AsyncPackage
    {
        /// <summary>
        /// ClaudeCodeForVSPackage GUID string. / ClaudeCodeForVSPackage 的 GUID 字符串。
        /// </summary>
        public const string PackageGuidString = "6509041c-08eb-4515-92e3-bb69c995aeec";

        #region Package Members

        /// <summary>
        /// Initialization of the package; this method is called right after the package is sited, so this is the place / 包初始化入口，在包完成驻留后调用
        /// where you can put all the initialization code that rely on services provided by VisualStudio. / 可在此放置依赖 VS 服务的初始化逻辑。
        /// </summary>
        /// <param name="cancellationToken">A cancellation token to monitor for initialization cancellation, which can occur when VS is shutting down. / 初始化取消令牌（如 VS 关闭时触发）。</param>
        /// <param name="progress">A provider for progress updates. / 初始化进度提供者。</param>
        /// <returns>A task representing the async work of package initialization, or an already completed task if there is none. Do not return null from this method. / 返回初始化任务；若无工作则返回已完成任务，不可返回 null。</returns>
        protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            try
            {
                // Initialize Logging / 初始化日志
                LogService.Initialize();
                LogService.Info("Starting ClaudeCodeForVS package initialization...");

                // When initialized asynchronously, the current thread may be a background thread at this point. / 异步初始化时当前线程可能是后台线程。
                // Do any initialization that requires the UI thread after switching to the UI thread. / 需要 UI 线程的初始化应在切换后执行。
                await this.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
                LogService.Debug("Switched to UI thread");

                // Initialize Output Window Pane / 初始化输出窗口面板
                try
                {
                    if (await GetServiceAsync(typeof(SVsOutputWindow)) is IVsOutputWindow outputWindow)
                    {
                        var guid = ClaudeAgentBridge.ClaudeCodePaneGuid;
                        outputWindow.CreatePane(ref guid, "Claude Code", 1, 1);
                        LogService.Debug("Output window pane created");
                    }
                    else
                    {
                        LogService.Warn("Failed to get IVsOutputWindow service");
                    }
                }
                catch (Exception ex)
                {
                    LogService.Error("Failed to initialize output window pane", ex);
                }

                // Initialize Editor Context Service / 初始化编辑器上下文服务
                try
                {
                    if (await GetServiceAsync(typeof(EnvDTE.DTE)) is DTE2 dte)
                    {
                        EditorContextService.Instance.Initialize(dte);
                        LogService.Debug("Editor context service initialized");
                    }
                    else
                    {
                        LogService.Warn("Failed to get DTE2 service");
                    }
                }
                catch (Exception ex)
                {
                    LogService.Error("Failed to initialize editor context service", ex);
                }

                // Initialize Claude Chat Command / 初始化 Claude Chat 命令
                try
                {
                    await ClaudeChatCommand.InitializeAsync(this);
                    LogService.Info("ClaudeCodeForVS package initialization completed successfully");
                }
                catch (Exception ex)
                {
                    LogService.Error("Failed to initialize Claude Chat command", ex);
                    throw;
                }
            }
            catch (Exception ex)
            {
                LogService.Error("Fatal error during package initialization", ex);
                throw;
            }
        }

        #endregion Package Members
    }
}
