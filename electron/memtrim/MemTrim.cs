// Tiny helper that keeps the app's memory low, for the process ids passed on
// the command line. Compiled once by electron/memTrimmer.js with the C#
// compiler that ships with Windows (.NET Framework 4), so no binary is
// committed. Starting it takes a few milliseconds.
//
//   MemTrim.exe pid...               hands unused pages back (EmptyWorkingSet)
//   MemTrim.exe --cap MB pid...      hard working-set ceiling of MB per process:
//                                    Windows keeps each one under it by moving
//                                    its least-used pages out a few at a time
//                                    (no all-at-once trim, so no stutter)
//   MemTrim.exe --cap 0 pid...       removes the ceiling
using System;
using System.Runtime.InteropServices;

static class MemTrim
{
    const uint PROCESS_SET_QUOTA = 0x0100;
    const uint PROCESS_QUERY_INFORMATION = 0x0400;
    const uint QUOTA_LIMITS_HARDWS_MIN_DISABLE = 0x2;
    const uint QUOTA_LIMITS_HARDWS_MAX_ENABLE = 0x4;
    const uint QUOTA_LIMITS_HARDWS_MAX_DISABLE = 0x8;

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("psapi.dll")]
    static extern bool EmptyWorkingSet(IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetProcessWorkingSetSizeEx(IntPtr process, UIntPtr minimum, UIntPtr maximum, uint flags);

    static int Main(string[] args)
    {
        int done = 0;
        long capMb = -1;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--cap" && i + 1 < args.Length)
            {
                long.TryParse(args[++i], out capMb);
                continue;
            }
            int pid;
            if (!int.TryParse(args[i], out pid)) continue;
            IntPtr handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION, false, pid);
            if (handle == IntPtr.Zero) continue;
            bool ok;
            if (capMb > 0)
            {
                ulong max = (ulong)capMb * 1024 * 1024;
                ok = SetProcessWorkingSetSizeEx(handle, (UIntPtr)(1024UL * 1024), (UIntPtr)max,
                    QUOTA_LIMITS_HARDWS_MAX_ENABLE | QUOTA_LIMITS_HARDWS_MIN_DISABLE);
            }
            else if (capMb == 0)
            {
                ok = SetProcessWorkingSetSizeEx(handle, (UIntPtr)(1024UL * 1024), (UIntPtr)(64UL * 1024 * 1024),
                    QUOTA_LIMITS_HARDWS_MAX_DISABLE | QUOTA_LIMITS_HARDWS_MIN_DISABLE);
            }
            else
            {
                ok = EmptyWorkingSet(handle);
            }
            if (ok) done++;
            CloseHandle(handle);
        }
        return done;
    }
}
