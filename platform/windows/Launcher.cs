// SPDX-License-Identifier: MIT
using System;
using System.IO;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.ComponentModel;

class Launcher {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attrs, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorking, MaxWorking; public uint ActiveLimit; public UIntPtr Affinity; public uint Priority, Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
  static string Quote(string value) {
    var result=new System.Text.StringBuilder("\""); int slashes=0;
    foreach(char ch in value) {
      if(ch=='\\') { slashes++; continue; }
      if(ch=='\"') result.Append('\\',slashes*2+1).Append(ch);
      else result.Append('\\',slashes).Append(ch);
      slashes=0;
    }
    return result.Append('\\',slashes*2).Append('"').ToString();
  }
  static async Task Pump(Stream input, Stream output) {
    byte[] buffer=new byte[4096]; int count;
    while((count=await input.ReadAsync(buffer,0,buffer.Length))>0) {
      await output.WriteAsync(buffer,0,count); await output.FlushAsync();
    }
  }
  static int Main(string[] args) {
    IntPtr job=IntPtr.Zero;
    Process child=null;
    try {
      string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
      string node=File.ReadAllText(Path.Combine(root,".local","node-path.txt")).Trim();
      var info=new ProcessStartInfo(node);
      info.Arguments=Quote(Path.Combine(root,"src","adapter.mjs"));
      foreach(string arg in args) info.Arguments+=" "+Quote(arg);
      info.UseShellExecute=false; info.CreateNoWindow=true;
      info.RedirectStandardInput=true; info.RedirectStandardOutput=true; info.RedirectStandardError=true;
      job=CreateJobObject(IntPtr.Zero,null);
      if(job==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot create the adapter process job");
      {
        var limits=new ExtendedLimits(); limits.Basic.Flags=0x2000;
        int size=Marshal.SizeOf(typeof(ExtendedLimits)); IntPtr p=Marshal.AllocHGlobal(size);
        try {
          Marshal.StructureToPtr(limits,p,false);
          if(!SetInformationJobObject(job,9,p,(uint)size)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot configure the adapter process job");
        }
        finally { Marshal.FreeHGlobal(p); }
      }
      child=Process.Start(info);
      if(!AssignProcessToJobObject(job,child.Handle)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot bind the adapter process lifetime to its launcher");
      var output=Pump(child.StandardOutput.BaseStream,Console.OpenStandardOutput());
      var error=Pump(child.StandardError.BaseStream,Console.OpenStandardError());
      Task.Run(async delegate { try { await Pump(Console.OpenStandardInput(),child.StandardInput.BaseStream); child.StandardInput.Close(); } catch {} });
      child.WaitForExit(); Task.WaitAll(output,error); return child.ExitCode;
    } catch(Exception e) {
      if(child!=null) { try { if(!child.HasExited) child.Kill(); } catch {} }
      Console.Error.WriteLine("Raft agent adapter launcher: "+e.Message); return 1;
    }
    finally { if(job!=IntPtr.Zero) CloseHandle(job); if(child!=null) child.Dispose(); }
  }
}
