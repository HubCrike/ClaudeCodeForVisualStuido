using ClaudeCodeForVS.Services;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace ClaudeCodeForVS.Services
{
    public static class WindowsCommandResolver
    {
        private static readonly string[] Extensions =
        {
            ".exe",
            ".cmd"
        };

        public static string Resolve(string commandName)
        {
            var paths = new List<string>();

            // 1) 当前进程 PATH / Current process PATH
            var envPath = Environment.GetEnvironmentVariable("PATH");
            if (!string.IsNullOrWhiteSpace(envPath))
            {
                paths.AddRange(envPath.Split(';'));
            }

            // 2) npm 全局 bin / Global npm bin
            var npmBin = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm");

            if (Directory.Exists(npmBin))
            {
                paths.Add(npmBin);
            }

            paths = paths.Distinct().ToList();

            foreach (var dir in paths)
            {
                foreach (var ext in Extensions)
                {
                    var full = Path.Combine(dir, commandName + ext);
                    if (File.Exists(full))
                    {

                        LogService.Info($"Found executable: {full}");
                        return full;
                    }
                }
            }

            LogService.Error($"Command not found on Windows: {commandName} (tried exe/cmd)");
            return $"{commandName}";
        }
    }
}
