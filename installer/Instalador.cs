// Instalador do Huddle: uma janela onde a pessoa escolhe a pasta, e o instalador
// baixa o app do servidor, confere a assinatura e o SHA-256, instala, cria os atalhos, registra
// em "Aplicativos instalados" (com desinstalação) e abre o app.
// Compilado com o C# que vem no Windows: scripts/build-installer.js
//
//   Instalar-Huddle.exe                     janela normal
//   Instalar-Huddle.exe /silent /dir:<pasta> [/noshortcuts] [/noopen]   sem janela (testes)
//   Desinstalar.exe /uninstall              (cópia dentro da pasta do app)
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Instalador do Huddle")]
[assembly: AssemblyDescription("Instalador oficial do Huddle para Windows")]
[assembly: AssemblyCompany("Huddle")]
[assembly: AssemblyProduct("Huddle")]
[assembly: AssemblyCopyright("Huddle")]
[assembly: AssemblyVersion("1.2.17.0")]
[assembly: AssemblyFileVersion("1.2.17.0")]

static class Program
{
    public const string AppName = "Huddle";
    // Name used up to 1.2.10: its install folder, shortcuts and executable are taken over
    public const string OldAppName = "Invadominio zak' zak";
    public const string Base = "https://129-159-51-96.sslip.io/download";
    public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Huddle";
    public const string UninstallerName = "Desinstalar.exe";
    // Public key that signs every release (ECDSA P-256; the private key never
    // leaves the developer's PC). Same key as electron/updateSignature.js.
    const string SigningKeyX = "LsNkEIar9FnMrqzQ4PPBKGBOU+ppnfco8GCfNpoaLnA=";
    const string SigningKeyY = "+cwmOWJgflIBPzXm51zlMxAAcMCTMRQxFR3byXQ79ZY=";

    // True only if manifest.json was signed with the release key
    public static bool VerifyManifest(byte[] manifest, string signatureBase64)
    {
        byte[] sig;
        try { sig = Convert.FromBase64String((signatureBase64 ?? "").Trim()); } catch { return false; }
        if (sig.Length != 64) return false;
        ECParameters p = new ECParameters();
        p.Curve = ECCurve.NamedCurves.nistP256;
        ECPoint q = new ECPoint();
        q.X = Convert.FromBase64String(SigningKeyX);
        q.Y = Convert.FromBase64String(SigningKeyY);
        p.Q = q;
        try
        {
            using (ECDsa ec = ECDsa.Create(p)) return ec.VerifyData(manifest, sig, HashAlgorithmName.SHA256);
        }
        catch { return false; }
    }

    // Reads one field of the small, fixed-format manifest.json
    public static string ManifestField(string json, string name)
    {
        Match m = Regex.Match(json, "\"" + name + "\"\\s*:\\s*\"?([0-9a-zA-Z.]+)\"?");
        return m.Success ? m.Groups[1].Value : "";
    }

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool silent = false, shortcuts = true, open = true;
        string dir = null;
        foreach (string a in args)
        {
            if (a == "/uninstall") return Uninstall.Run();
            if (a == "/silent") silent = true;
            else if (a == "/noshortcuts") shortcuts = false;
            else if (a == "/noopen") open = false;
            else if (a.StartsWith("/dir:")) dir = a.Substring(5);
            else if (a.StartsWith("/screenshot:")) return Screenshot(a.Substring(12));
        }

        bool createdNew;
        using (Mutex mutex = new Mutex(true, @"Local\HuddleInstallerMutex", out createdNew))
        {
            if (!createdNew && !silent)
            {
                MessageBox.Show("O instalador do Huddle já está aberto.", "Instalar o Huddle", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            if (silent)
            {
                InstallJob job = new InstallJob { Dir = SafeTarget(dir ?? DefaultFolder()), Desktop = shortcuts, StartMenu = shortcuts, Open = open };
                job.Progress = (msg, p) => Console.WriteLine(msg);
                try { job.Run(); Console.WriteLine("OK " + job.Dir); return 0; }
                catch (Exception e) { Console.WriteLine("ERRO " + InstallJob.Describe(e)); return 1; }
            }
            Application.Run(new InstallerForm());
            return 0;
        }
    }

    // Draws the window off-screen into a PNG (for the website and for checking the layout)
    static int Screenshot(string png)
    {
        InstallerForm form = new InstallerForm { StartPosition = FormStartPosition.Manual, Location = new Point(-20000, -20000), ShowInTaskbar = false };
        // A neutral example: never anyone's real user folder
        form.folderBox.Text = @"C:\Users\voce\AppData\Local\Huddle";
        form.status.Text = "";
        form.installBtn.Text = "Instalar";
        form.Show();
        Application.DoEvents();
        using (Bitmap bmp = new Bitmap(form.Width, form.Height))
        {
            form.DrawToBitmap(bmp, new Rectangle(0, 0, form.Width, form.Height));
            bmp.Save(png, System.Drawing.Imaging.ImageFormat.Png);
        }
        form.Close();
        return 0;
    }

    public static string ExePath(string dir) { return Path.Combine(dir, AppName + ".exe"); }
    public static string OldExePath(string dir) { return Path.Combine(dir, OldAppName + ".exe"); }
    public static bool HasApp(string dir) { return File.Exists(ExePath(dir)) || File.Exists(OldExePath(dir)); }

    public static string DefaultFolder()
    {
        return PreviousInstall() ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Huddle");
    }

    // A folder the app owns: missing, empty, or already has the app in it
    public static bool IsOwnFolder(string dir)
    {
        if (!Directory.Exists(dir)) return true;
        if (HasApp(dir)) return true;
        return Directory.GetFileSystemEntries(dir).Length == 0;
    }

    // Installing replaces everything in the folder: a folder with other files
    // (Documents, Desktop...) gets its own "Huddle" subfolder
    public static string SafeTarget(string dir)
    {
        dir = Path.GetFullPath(dir.Trim());
        return IsOwnFolder(dir) ? dir : Path.Combine(dir, "Huddle");
    }

    public static string PreviousInstall()
    {
        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(UninstallKey))
        {
            string dir = k == null ? null : k.GetValue("InstallLocation") as string;
            if (!string.IsNullOrEmpty(dir) && HasApp(dir)) return dir;
        }
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (string name in new[] { "Huddle", "Invadominio" })
        {
            string d = Path.Combine(local, name);
            if (HasApp(d)) return d;
        }
        return null;
    }

    // Stops only the app's own processes (instead of enumerating every process in Windows)
    public static void StopRunningApp(string dir)
    {
        string prefix = dir.TrimEnd('\\') + "\\";
        string oldEcoDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Eco").TrimEnd('\\') + "\\";
        int selfPid = Process.GetCurrentProcess().Id;
        string[] appProcessNames = new[] { AppName, OldAppName, "Eco", "SystemAudio", "MemTrim" };
        foreach (string procName in appProcessNames)
        {
            Process[] list;
            try { list = Process.GetProcessesByName(procName); }
            catch { continue; }
            foreach (Process p in list)
            {
                try
                {
                    if (p.Id == selfPid) continue;
                    string path = p.MainModule.FileName;
                    if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
                        path.StartsWith(oldEcoDir, StringComparison.OrdinalIgnoreCase))
                    {
                        p.Kill();
                        p.WaitForExit(5000);
                    }
                }
                catch { }
                finally { p.Dispose(); }
            }
        }
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    class ShellLink { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cchMaxPath, IntPtr pfd, int fFlags);
        void GetIDList(out IntPtr ppidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMaxName);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cchMaxPath);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cchMaxPath);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
        void GetHotkey(out short pwHotkey);
        void SetHotkey(short wHotkey);
        void GetShowCmd(out int piShowCmd);
        void SetShowCmd(int iShowCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cchIconPath, out int piIcon);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, int dwReserved);
        void Resolve(IntPtr hwnd, int fFlags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
    }

    public static void CreateShortcut(string lnkPath, string target, string workDir)
    {
        IShellLinkW link = (IShellLinkW)new ShellLink();
        link.SetPath(target);
        link.SetWorkingDirectory(workDir);
        link.SetIconLocation(target, 0);
        link.SetDescription(AppName);
        ((IPersistFile)link).Save(lnkPath, false);
    }

    public static string Desktop(string name) { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), name + ".lnk"); }
    public static string StartMenu(string name) { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), name + ".lnk"); }

    public static void DeleteQuietly(string file) { try { if (File.Exists(file)) File.Delete(file); } catch { } }
}

class InstallJob
{
    public string Dir;
    public bool Desktop = true, StartMenu = true, Open = true;
    public Action<string, int> Progress = delegate { };
    public volatile bool Canceled;

    public void Run()
    {
        int pid = Process.GetCurrentProcess().Id;
        string zip = Path.Combine(Path.GetTempPath(), "Huddle-instalador-" + pid + ".zip");
        string staging = Path.Combine(Path.GetTempPath(), "Huddle-instalador-" + pid);
        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            Progress("Conectando ao servidor...", -1);
            // The signed manifest says what to expect; without a valid signature nothing is installed
            byte[] manifest;
            string signature;
            using (WebClient wc = new WebClient())
            {
                manifest = wc.DownloadData(Program.Base + "/manifest.json");
                byte[] sigBytes = wc.DownloadData(Program.Base + "/manifest.sig");
                signature = Encoding.UTF8.GetString(sigBytes).Trim();
            }
            if (!Program.VerifyManifest(manifest, signature))
                throw new Exception("O pacote do servidor não tem a assinatura oficial do Huddle. Nada foi instalado.");
            string manifestText = Encoding.UTF8.GetString(manifest);
            string expected = Program.ManifestField(manifestText, "sha256").ToLowerInvariant();
            long expectedSize;
            if (expected.Length != 64 || !long.TryParse(Program.ManifestField(manifestText, "size"), out expectedSize))
                throw new Exception("O pacote do servidor está com dados inválidos. Nada foi instalado.");

            Download(Program.Base + "/Eco.zip", zip);
            if (Canceled) throw new OperationCanceledException();

            Progress("Conferindo o arquivo baixado...", -1);
            string actual;
            using (FileStream fs = File.OpenRead(zip))
            using (SHA256 sha = SHA256.Create())
                actual = BitConverter.ToString(sha.ComputeHash(fs)).Replace("-", "").ToLowerInvariant();
            if (actual != expected || new FileInfo(zip).Length != expectedSize) throw new Exception("O arquivo baixado veio corrompido. Tente de novo.");

            Progress("Instalando em " + Dir + " ...", -1);
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            ZipFile.ExtractToDirectory(zip, staging);
            if (!Program.HasApp(staging)) throw new Exception("O pacote baixado está incompleto.");

            Program.StopRunningApp(Dir);
            Thread.Sleep(1000);
            Directory.CreateDirectory(Dir);
            string selfExe = Application.ExecutablePath;
            for (int attempt = 1; attempt <= 5; attempt++)
            {
                try
                {
                    foreach (string f in Directory.GetFiles(Dir))
                    {
                        if (string.Equals(f, selfExe, StringComparison.OrdinalIgnoreCase)) continue;
                        File.Delete(f);
                    }
                    foreach (string d in Directory.GetDirectories(Dir)) Directory.Delete(d, true);
                    break;
                }
                catch
                {
                    if (attempt == 5) throw;
                    Program.StopRunningApp(Dir);
                    Thread.Sleep(1000);
                }
            }
            // Moved file by file: Directory.Move only works within one drive, and
            // the temp folder is on C: while the chosen folder may be on D:, E:...
            MoveTree(staging, Dir);
            Directory.Delete(staging, true);
            File.Delete(zip);

            // Clean up legacy Eco installation if present
            string oldEcoDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Eco");
            if (Directory.Exists(oldEcoDir) && !string.Equals(oldEcoDir, Dir, StringComparison.OrdinalIgnoreCase))
            {
                try { Directory.Delete(oldEcoDir, true); } catch { }
            }

            string exe = File.Exists(Program.ExePath(Dir)) ? Program.ExePath(Dir) : Program.OldExePath(Dir);
            // Shortcuts with the old name go; the new ones point at Huddle
            foreach (string old in new[] { Program.Desktop(Program.OldAppName), Program.StartMenu(Program.OldAppName), Program.Desktop("Eco"), Program.StartMenu("Eco") })
                Program.DeleteQuietly(old);
            if (Desktop) Program.CreateShortcut(Program.Desktop(Program.AppName), exe, Dir);
            if (StartMenu) Program.CreateShortcut(Program.StartMenu(Program.AppName), exe, Dir);
            RegisterUninstall(exe);
            Progress("Pronto! O Huddle está instalado.", 1000);
            if (Open) Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = Dir });
        }
        finally
        {
            try { if (File.Exists(zip)) File.Delete(zip); } catch { }
            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { }
        }
    }

    static void MoveTree(string from, string to)
    {
        Directory.CreateDirectory(to);
        bool sameDrive = string.Equals(Path.GetPathRoot(from), Path.GetPathRoot(to), StringComparison.OrdinalIgnoreCase);
        foreach (string f in Directory.GetFiles(from))
        {
            string target = Path.Combine(to, Path.GetFileName(f));
            if (sameDrive && !File.Exists(target)) File.Move(f, target);
            else File.Copy(f, target, true);
        }
        foreach (string d in Directory.GetDirectories(from)) MoveTree(d, Path.Combine(to, Path.GetFileName(d)));
    }

    public static string Describe(Exception e)
    {
        if (e is OperationCanceledException) return "Instalação cancelada.";
        if (e is WebException) return "Não foi possível baixar o app. Confira a internet e tente de novo.";
        if (e is UnauthorizedAccessException) return "Sem permissão para gravar nessa pasta. Escolha outra (por exemplo, dentro da sua pasta de usuário).";
        if (e is IOException) return "Não foi possível gravar os arquivos (" + e.Message + "). Feche o app e tente de novo.";
        return e.Message;
    }

    void Download(string url, string target)
    {
        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
        req.UserAgent = "HuddleInstalador/1.0";
        using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
        using (Stream input = res.GetResponseStream())
        using (FileStream output = File.Create(target))
        {
            long total = res.ContentLength, done = 0;
            byte[] buf = new byte[1 << 16];
            int n, lastShown = -1;
            while ((n = input.Read(buf, 0, buf.Length)) > 0)
            {
                if (Canceled) return;
                output.Write(buf, 0, n);
                done += n;
                int permille = total > 0 ? (int)(done * 1000 / total) : -1;
                if (permille / 5 != lastShown)
                {
                    lastShown = permille / 5;
                    Progress(total > 0
                        ? string.Format("Baixando... {0} de {1} MB", done / 1048576, total / 1048576)
                        : string.Format("Baixando... {0} MB", done / 1048576), permille);
                }
            }
        }
    }

    void RegisterUninstall(string exe)
    {
        string uninstaller = Path.Combine(Dir, Program.UninstallerName);
        if (!string.Equals(Application.ExecutablePath, uninstaller, StringComparison.OrdinalIgnoreCase))
        {
            try { File.Copy(Application.ExecutablePath, uninstaller, true); } catch { }
        }
        string version = "";
        try { version = FileVersionInfo.GetVersionInfo(exe).ProductVersion; } catch { }
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Program.UninstallKey))
        {
            k.SetValue("DisplayName", Program.AppName);
            k.SetValue("DisplayIcon", exe + ",0");
            k.SetValue("DisplayVersion", version ?? "");
            k.SetValue("Publisher", "davisantanadev");
            k.SetValue("InstallLocation", Dir);
            k.SetValue("UninstallString", "\"" + uninstaller + "\" /uninstall");
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
        try
        {
            string iconPath = Path.Combine(Dir, "resources", "app", "assets", "app.ico");
            using (RegistryKey aumid = Registry.CurrentUser.CreateSubKey(@"Software\Classes\AppUserModelId\com.invadominio.zakzak"))
            {
                aumid.SetValue("DisplayName", Program.AppName);
                if (File.Exists(iconPath)) aumid.SetValue("IconUri", iconPath);
            }
        }
        catch { }
    }
}

class InstallerForm : Form
{
    readonly Color bg = Color.FromArgb(23, 26, 38);
    readonly Color field = Color.FromArgb(36, 40, 58);
    readonly Color text = Color.FromArgb(238, 240, 247);
    readonly Color muted = Color.FromArgb(160, 166, 190);
    readonly Color accent = Color.FromArgb(255, 122, 69);

    internal TextBox folderBox;
    CheckBox desktopCheck, startCheck, openCheck;
    internal Button browseBtn, installBtn, cancelBtn;
    ProgressBar bar;
    internal Label status;
    InstallJob job;

    public InstallerForm()
    {
        Text = "Instalar o Huddle";
        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(560, 396);
        BackColor = bg;
        ForeColor = text;
        Font = new Font("Segoe UI", 10f);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Label title = new Label { Text = "Huddle", Font = new Font("Segoe UI Semibold", 22f), AutoSize = true, Location = new Point(28, 18), ForeColor = text };
        Label subtitle = new Label { Text = "Escolha onde instalar. O app é baixado do servidor (cerca de 120 MB).", AutoSize = true, Location = new Point(30, 66), ForeColor = muted };

        Label folderLabel = new Label { Text = "Pasta de instalação", AutoSize = true, Location = new Point(30, 108), ForeColor = text };
        string previous = Program.PreviousInstall();
        folderBox = new TextBox { Text = Program.DefaultFolder(), Location = new Point(30, 132), Width = 390, BackColor = field, ForeColor = text, BorderStyle = BorderStyle.FixedSingle };
        browseBtn = MakeButton("Procurar...", new Point(430, 130), 100, false);
        browseBtn.Click += delegate { Browse(); };

        desktopCheck = MakeCheck("Criar atalho na Área de Trabalho", new Point(30, 176));
        startCheck = MakeCheck("Criar atalho no Menu Iniciar", new Point(30, 204));
        openCheck = MakeCheck("Abrir o Huddle quando terminar", new Point(30, 232));

        bar = new ProgressBar { Location = new Point(30, 276), Width = 500, Height = 10, Visible = false, Maximum = 1000 };
        status = new Label
        {
            Text = previous != null ? "O app já está instalado nesta pasta. Instalar de novo atualiza para a versão mais nova, sem mexer nas suas contas." : "",
            AutoSize = false, Width = 500, Height = 40, Location = new Point(30, 292), ForeColor = muted
        };

        installBtn = MakeButton(previous != null ? "Atualizar" : "Instalar", new Point(410, 346), 120, true);
        installBtn.Click += delegate { StartInstall(); };
        cancelBtn = MakeButton("Cancelar", new Point(300, 346), 100, false);
        cancelBtn.Click += delegate { if (job != null) job.Canceled = true; else Close(); };
        AcceptButton = installBtn;
        Shown += delegate { installBtn.Focus(); };

        Controls.AddRange(new Control[] { title, subtitle, folderLabel, folderBox, browseBtn, desktopCheck, startCheck, openCheck, bar, status, installBtn, cancelBtn });
        FormClosing += (s, e) => { if (job != null) { job.Canceled = true; e.Cancel = true; } };
    }

    Button MakeButton(string label, Point at, int width, bool primary)
    {
        Button b = new Button { Text = label, Location = at, Width = width, Height = 34, FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand };
        b.FlatAppearance.BorderSize = primary ? 0 : 1;
        b.FlatAppearance.BorderColor = muted;
        b.BackColor = primary ? accent : bg;
        b.ForeColor = primary ? bg : text;
        if (primary) b.Font = new Font("Segoe UI Semibold", 10f);
        return b;
    }

    // The Windows theme paints a checkbox's own text black on some PCs, whatever
    // ForeColor says: the box has no text and a label beside it carries it
    // (clicking the label toggles the box, like the built-in text would)
    CheckBox MakeCheck(string label, Point at)
    {
        CheckBox box = new CheckBox { Text = "", Checked = true, AutoSize = true, Location = at, Cursor = Cursors.Hand, AccessibleName = label };
        Label caption = new Label { Text = label, AutoSize = true, Location = new Point(at.X + 20, at.Y + 1), ForeColor = text, BackColor = bg, Cursor = Cursors.Hand };
        caption.Click += delegate { if (box.Enabled) box.Checked = !box.Checked; };
        box.EnabledChanged += delegate { caption.ForeColor = box.Enabled ? text : muted; };
        Controls.Add(caption);
        return box;
    }

    void Browse()
    {
        using (FolderBrowserDialog d = new FolderBrowserDialog())
        {
            d.Description = "Escolha a pasta onde o Huddle vai ficar";
            d.ShowNewFolderButton = true;
            d.SelectedPath = Directory.Exists(folderBox.Text) ? folderBox.Text : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (d.ShowDialog(this) == DialogResult.OK) folderBox.Text = Program.SafeTarget(d.SelectedPath);
        }
    }

    void SetControlsEnabled(bool enabled)
    {
        foreach (Control c in new Control[] { folderBox, browseBtn, desktopCheck, startCheck, openCheck, installBtn }) c.Enabled = enabled;
    }

    void StartInstall()
    {
        string dir;
        try { dir = Program.SafeTarget(folderBox.Text); }
        catch { status.Text = "Esse caminho de pasta não é válido. Use Procurar... para escolher uma pasta."; return; }
        folderBox.Text = dir;
        job = new InstallJob { Dir = dir, Desktop = desktopCheck.Checked, StartMenu = startCheck.Checked, Open = openCheck.Checked };
        job.Progress = (msg, p) => BeginInvoke((MethodInvoker)delegate
        {
            status.Text = msg;
            if (p >= 0) { bar.Style = ProgressBarStyle.Continuous; bar.Value = Math.Min(1000, p); }
            else bar.Style = ProgressBarStyle.Marquee;
        });
        SetControlsEnabled(false);
        bar.Visible = true;
        InstallJob running = job;
        Thread worker = new Thread(delegate ()
        {
            Exception error = null;
            try { running.Run(); } catch (Exception e) { error = e; }
            BeginInvoke((MethodInvoker)delegate
            {
                job = null;
                if (error == null)
                {
                    if (running.Open) { Close(); return; }
                    bar.Visible = false;
                    cancelBtn.Text = "Fechar";
                    return;
                }
                status.Text = InstallJob.Describe(error);
                bar.Visible = false;
                SetControlsEnabled(true);
                installBtn.Text = "Tentar de novo";
            });
        });
        worker.IsBackground = true;
        worker.Start();
    }
}

static class Uninstall
{
    public static int Run()
    {
        string dir = Path.GetDirectoryName(Application.ExecutablePath);
        if (!Program.HasApp(dir))
        {
            MessageBox.Show("O Huddle não foi encontrado nesta pasta.", "Desinstalar o Huddle");
            return 1;
        }
        if (MessageBox.Show("Remover o Huddle deste computador?\n\nSuas contas e configurações ficam guardadas, caso você instale de novo.",
            "Desinstalar o Huddle", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 0;
        Program.StopRunningApp(dir);
        Thread.Sleep(800);
        foreach (string name in new[] { Program.AppName, Program.OldAppName, "Eco" })
        {
            Program.DeleteQuietly(Program.Desktop(name));
            Program.DeleteQuietly(Program.StartMenu(name));
        }
        try { Registry.CurrentUser.DeleteSubKeyTree(Program.UninstallKey, false); } catch { }
        string me = Application.ExecutablePath;
        foreach (string f in Directory.GetFiles(dir))
            if (!string.Equals(f, me, StringComparison.OrdinalIgnoreCase)) Program.DeleteQuietly(f);
        foreach (string d in Directory.GetDirectories(dir)) try { Directory.Delete(d, true); } catch { }
        MessageBox.Show("O Huddle foi removido.", "Desinstalar o Huddle");
        return 0;
    }
}
