// Tiny helper that hands the app's unused memory pages back to Windows
// (EmptyWorkingSet) for the process ids passed on the command line.
// Compiled once by electron/memTrimmer.js with the C# compiler that ships with
// Windows (.NET Framework 4), so no binary is committed. Starting it takes a few
// milliseconds, unlike the PowerShell fallback (~0.5 s of CPU).
using System;
using System.Runtime.InteropServices;

static class MemTrim
{
    const uint PROCESS_SET_QUOTA = 0x0100;
    const uint PROCESS_QUERY_INFORMATION = 0x0400;

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("psapi.dll")]
    static extern bool EmptyWorkingSet(IntPtr process);

    static int Main(string[] args)
    {
        int trimmed = 0;
        foreach (string arg in args)
        {
            int pid;
            if (!int.TryParse(arg, out pid)) continue;
            IntPtr handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION, false, pid);
            if (handle == IntPtr.Zero) continue;
            if (EmptyWorkingSet(handle)) trimmed++;
            CloseHandle(handle);
        }
        return trimmed;
    }
}
