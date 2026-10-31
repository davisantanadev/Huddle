// Captures everything the PC is playing EXCEPT one process tree (Windows 10
// 2004+ process loopback), so a screen share's sound never contains the call's
// own voices. Writes raw PCM (48 kHz, stereo, 16-bit) to stdout until killed or
// until stdin closes. Compiled on first use by electron/systemAudio.js with the
// C# compiler that ships with Windows, so no binary is committed.
//
//   SystemAudio.exe <pid to exclude>
//
// Exit codes: 0 stopped, 2 bad arguments, 3 not supported / activation failed.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

static class SystemAudio
{
    const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    const int AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
    const int AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = unchecked((int)0x80000000);
    const int AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY = 0x08000000;
    const int AUDCLNT_BUFFERFLAGS_SILENT = 2;
    const ushort VT_BLOB = 65;

    [StructLayout(LayoutKind.Sequential)]
    struct ActivationParams
    {
        public int ActivationType; // 1 = process loopback
        public int TargetProcessId;
        public int ProcessLoopbackMode; // 1 = exclude the target's process tree
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct PropVariant
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public int cbSize;
        [FieldOffset(16)] public IntPtr pBlobData;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    class WaveFormat
    {
        public ushort wFormatTag = 1;
        public ushort nChannels = 2;
        public int nSamplesPerSec = 48000;
        public int nAvgBytesPerSec = 192000;
        public ushort nBlockAlign = 4;
        public ushort wBitsPerSample = 16;
        public ushort cbSize = 0;
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, [In, MarshalAs(UnmanagedType.LPStruct)] WaveFormat format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService([In] ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out int flags, out long devicePosition, out long qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        [PreserveSig] int GetActivateResult(out int result, [MarshalAs(UnmanagedType.IUnknown)] out object activated);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler
    {
        [PreserveSig] int ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation);
    }

    [ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    class Completion : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Done = new ManualResetEvent(false);
        public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
        {
            Done.Set();
            return 0;
        }
    }

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = true)]
    static extern int ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        [In] ref Guid riid,
        IntPtr activationParams,
        IActivateAudioInterfaceCompletionHandler completionHandler,
        out IActivateAudioInterfaceAsyncOperation operation);

    [MTAThread]
    static int Main(string[] args)
    {
        int pid;
        if (args.Length < 1 || !int.TryParse(args[0], out pid)) return 2;
        try
        {
            return Run(pid);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine(e.Message);
            return 3;
        }
    }

    static int Run(int pid)
    {
        ActivationParams ap = new ActivationParams { ActivationType = 1, TargetProcessId = pid, ProcessLoopbackMode = 1 };
        IntPtr apPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ActivationParams)));
        Marshal.StructureToPtr(ap, apPtr, false);
        PropVariant pv = new PropVariant { vt = VT_BLOB, cbSize = Marshal.SizeOf(typeof(ActivationParams)), pBlobData = apPtr };
        IntPtr pvPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(PropVariant)));
        Marshal.StructureToPtr(pv, pvPtr, false);

        Guid iidClient = typeof(IAudioClient).GUID;
        Completion completion = new Completion();
        IActivateAudioInterfaceAsyncOperation op;
        int hr = ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iidClient, pvPtr, completion, out op);
        if (hr != 0) { Console.Error.WriteLine("activate 0x" + hr.ToString("X")); return 3; }
        if (!completion.Done.WaitOne(5000)) { Console.Error.WriteLine("activate timeout"); return 3; }

        int result;
        object activated;
        hr = op.GetActivateResult(out result, out activated);
        if (hr != 0 || result != 0) { Console.Error.WriteLine("result 0x" + result.ToString("X")); return 3; }
        IAudioClient client = (IAudioClient)activated;

        hr = client.Initialize(0, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            200000, 0, new WaveFormat(), IntPtr.Zero);
        if (hr != 0) { Console.Error.WriteLine("init 0x" + hr.ToString("X")); return 3; }

        AutoResetEvent ready = new AutoResetEvent(false);
        hr = client.SetEventHandle(ready.SafeWaitHandle.DangerousGetHandle());
        if (hr != 0) return 3;
        Guid iidCapture = typeof(IAudioCaptureClient).GUID;
        object svc;
        hr = client.GetService(ref iidCapture, out svc);
        if (hr != 0) return 3;
        IAudioCaptureClient capture = (IAudioCaptureClient)svc;
        hr = client.Start();
        if (hr != 0) return 3;

        // The parent closing our stdin (or dying) ends the capture
        bool running = true;
        Thread watcher = new Thread(delegate ()
        {
            try { Console.OpenStandardInput().Read(new byte[1], 0, 1); } catch { }
            running = false;
            ready.Set();
        });
        watcher.IsBackground = true;
        watcher.Start();

        Stream stdout = Console.OpenStandardOutput();
        byte[] chunk = new byte[192000];
        while (running)
        {
            ready.WaitOne(100);
            uint frames;
            while (running && capture.GetNextPacketSize(out frames) == 0 && frames > 0)
            {
                IntPtr data; int flags; long p1, p2;
                if (capture.GetBuffer(out data, out frames, out flags, out p1, out p2) != 0) break;
                int bytes = Math.Min((int)frames * 4, chunk.Length);
                if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0) Array.Clear(chunk, 0, bytes);
                else Marshal.Copy(data, chunk, 0, bytes);
                capture.ReleaseBuffer(frames);
                try { stdout.Write(chunk, 0, bytes); stdout.Flush(); }
                catch { running = false; }
            }
        }
        client.Stop();
        return 0;
    }
}
