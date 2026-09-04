import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, Play, Loader2, X, Terminal } from "lucide-react";

interface CodeBlockProps {
  language?: string;
  code: string;
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [runOutput, setRunOutput] = useState<{ stdout: string; stderr: string; exit_code: number } | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRun = async () => {
    setRunning(true);
    setRunOutput(null);
    try {
      let cmd = code;
      const lang = (language || "").toLowerCase();
      if (lang === "python" || lang === "py") {
        cmd = `python3 -c ${JSON.stringify(code)}`;
      } else if (lang === "sh" || lang === "bash") {
        cmd = code;
      }

      const res = await invoke<{ exit_code: number; stdout: string; stderr: string }>("execute_sandbox_shell", {
        cmd,
        timeoutSecs: 30,
      });
      setRunOutput(res);
    } catch (err: any) {
      setRunOutput({ stdout: "", stderr: String(err), exit_code: -1 });
    } finally {
      setRunning(false);
    }
  };

  const cleanLang = (language || "text").toUpperCase();
  const isRunnable = ["PYTHON", "PY", "BASH", "SH", "SHELL"].includes(cleanLang);

  return (
    <div className="my-3 rounded-2xl overflow-hidden border border-[#E5E5EA] dark:border-[#2C2C2E] bg-[#141416] text-[#F4F4F5] text-xs font-mono shadow-md">
      {/* 顶栏信息 */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#1C1C1E] border-b border-[#2C2C2E] text-[11px] text-[#A1A1AA] select-none">
        <span className="font-semibold tracking-wider text-[#A1A1AA]">{cleanLang}</span>
        <div className="flex items-center gap-1.5">
          {isRunnable && (
            <button
              onClick={handleRun}
              disabled={running}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#27272A] hover:bg-[#3F3F46] text-[#E4E4E7] transition active:scale-95"
              title="在 Alpine Linux 沙箱中运行此代码"
            >
              {running ? (
                <Loader2 className="w-3 h-3 animate-spin text-[#0A84FF]" />
              ) : (
                <Play className="w-3 h-3 text-[#34C759] fill-current" />
              )}
              <span>{running ? "运行中..." : "沙箱运行"}</span>
            </button>
          )}

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#27272A] hover:bg-[#3F3F46] text-[#E4E4E7] transition active:scale-95"
            title="复制代码"
          >
            {copied ? <Check className="w-3 h-3 text-[#34C759]" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
        </div>
      </div>

      {/* 代码内容 */}
      <pre className="p-3.5 overflow-x-auto selection:bg-[#3F3F46] text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>

      {/* 沙箱执行输出抽屉 */}
      {runOutput !== null && (
        <div className="border-t border-[#2C2C2E] bg-[#09090B] p-3 text-[12px] text-[#A1A1AA]">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#71717A] mb-1.5 select-none">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-[#34C759]" />
              <span>沙箱执行结果 (Exit Code: {runOutput.exit_code})</span>
            </div>
            <button onClick={() => setRunOutput(null)} className="text-[#71717A] hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {runOutput.stdout && (
            <pre className="whitespace-pre-wrap text-[#D4D4D8] font-mono text-[12px] max-h-40 overflow-y-auto">
              {runOutput.stdout}
            </pre>
          )}
          {runOutput.stderr && (
            <pre className="whitespace-pre-wrap text-[#FF453A] font-mono text-[12px] max-h-40 overflow-y-auto mt-1">
              {runOutput.stderr}
            </pre>
          )}
          {!runOutput.stdout && !runOutput.stderr && (
            <div className="text-[#71717A] text-xs italic">(命令执行完成，无标准输出)</div>
          )}
        </div>
      )}
    </div>
  );
}
