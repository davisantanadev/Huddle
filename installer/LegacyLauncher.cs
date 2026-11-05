// "Invadominio zak' zak.exe": the app's executable name up to 1.2.10. Older
// versions restart the app by this name after updating themselves, and old
// shortcuts and taskbar pins point at it; it just opens Huddle.exe next to it.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;

[assembly: AssemblyTitle("Huddle")]
[assembly: AssemblyDescription("Huddle - inicializador de compatibilidade")]
[assembly: AssemblyCompany("Huddle")]
[assembly: AssemblyProduct("Huddle")]
[assembly: AssemblyCopyright("Huddle")]
[assembly: AssemblyVersion("1.2.17.0")]
[assembly: AssemblyFileVersion("1.2.17.0")]

static class LegacyLauncher
{
    static int Main(string[] args)
    {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string exe = Path.Combine(dir, "Huddle.exe");
        if (!File.Exists(exe)) return 1;
        string quoted = string.Join(" ", args.Select(a => "\"" + a.Replace("\"", "\\\"") + "\""));
        Process.Start(new ProcessStartInfo(exe, quoted) { WorkingDirectory = dir, UseShellExecute = false });
        return 0;
    }
}
