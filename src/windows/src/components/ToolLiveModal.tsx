import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  Check,
  Copy,
  Terminal,
  Globe,
  ShieldAlert,
  FileCode,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles
} from "lucide-react";
import { ToolStepStatus } from "./FloatingToolBar";

interface ToolLiveModalProps {
  step?: ToolStepStatus | null;
  toolInfo?: any;
  onClose: () => void;
  onTakeover?: (url: string) => void;
}

export function ToolLiveModal({ step, toolInfo, onClose, onTakeover }: ToolLiveModalProps) {
  const [copied, setCopied] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  // 兼顾通过 step 传参或旧版 toolInfo 传参
  const toolName = step?.toolName || toolInfo?.name || "tool_use";
  const toolTitle = step?.title || toolInfo?.label || toolName;
  const toolType = step?.toolType || (toolName.includes("browser") ? "browser" : toolName.includes("shell") ? "shell" : "other");
  const commandOrUrl = step?.commandOrUrl || "";
  const outputContent = step?.outputSnippet || toolInfo?.detail || toolInfo?.content || "";
  const previewImg = step?.previewImageUrl;

  useEffect(() => {
    if (!previewImg) {
      setPreviewDataUrl(null);
      return;
    }
    if (previewImg.startsWith("data:") || previewImg.startsWith("http")) {
      setPreviewDataUrl(previewImg);
      return;
    }
    let isMounted = true;
    invoke<string>("read_image_data_url", { pathOrUrl: previewImg })
      .then(url => {
        if (isMounted) setPreviewDataUrl(url);
      })
      .catch(() => {
        if (isMounted) setPreviewDataUrl(null);
      });
    return () => {
      isMounted = false;
    };
  }, [previewImg]);

  const handleCopy = () => {
    const textToCopy = outputContent || commandOrUrl || "";
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isBrowser = toolType === "browser" || toolName === "browser_use";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-150">
      <div className="bg-[#1C1C1E] border border-[#2C2C2E] w-full max-w-3xl rounded-[24px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-white font-sans">
        {/* 顶部标题栏 (1:1 原版 Minis Computer 经典规范) */}
        <div className="px-5 py-3.5 bg-[#2C2C2E]/80 border-b border-[#3A3A3C] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`w-2.5 h-2.5 rounded-full ${step?.status === "running" ? "bg-[#34C759] shadow-[0_0_8px_#34C759] animate-pulse" : "bg-[#34C759]"}`} />
            <span className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5">
              <span>Minis Computer</span>
            </span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-[#8E8E93]">
              {toolName}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* 浏览器场景：手动接管 */}
            {isBrowser && commandOrUrl && onTakeover && (
              <button
                onClick={() => onTakeover(commandOrUrl)}
                className="px-2.5 py-1 rounded-lg bg-[#FF9F0A] hover:bg-[#FF9F0A]/90 text-black text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
                title="在内置浏览器打开，处理登录或验证码"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>手动接管</span>
              </button>
            )}

            <button
              onClick={handleCopy}
              className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white transition flex items-center gap-1.5"
              title="复制执行日志"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#34C759]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "已复制" : "复制"}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#8E8E93] hover:text-white hover:bg-white/10 transition"
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 内容展示区 */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-[#0C0C0E]">
          {isBrowser ? (
            <div className="flex-1 flex flex-col rounded-xl overflow-hidden border border-[#2C2C2E] bg-black">
              {/* 模拟地址栏 */}
              <div className="px-3 py-1.5 bg-[#1C1C1E] border-b border-[#2C2C2E] flex items-center gap-2 text-xs text-[#8E8E93]">
                <Globe className="w-3.5 h-3.5 text-[#32ADE6] shrink-0" />
                <span className="font-mono text-white/90 truncate">{commandOrUrl || "https://..."}</span>
              </div>
              {/* 网页大图或正文 */}
              <div className="flex-1 min-h-[320px] flex items-center justify-center p-3 bg-[#141416]">
                {previewDataUrl ? (
                  <img
                    src={previewDataUrl}
                    alt="Web View"
                    className="max-h-[520px] w-auto rounded object-contain shadow-lg"
                  />
                ) : outputContent ? (
                  <div className="w-full p-3 font-mono text-xs text-[#D1D1D6] whitespace-pre-wrap leading-relaxed overflow-y-auto max-h-[500px]">
                    {outputContent}
                  </div>
                ) : (
                  <div className="text-center text-[#8E8E93] text-xs">
                    正在后台加载与渲染网页画面...
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 rounded-xl p-4 bg-black border border-[#2C2C2E] font-mono text-xs text-[#34C759] overflow-y-auto leading-relaxed space-y-2">
              <div className="text-[#8E8E93] flex items-center justify-between pb-2 border-b border-white/5 text-[11px]">
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-[#34C759]" />
                  <span>Alpine Linux (WSL2) Sandbox Execution</span>
                </div>
                <span className="text-[10px] text-white/40">{toolTitle}</span>
              </div>
              {commandOrUrl && (
                <div className="text-white flex items-center gap-1.5 pt-1">
                  <span className="text-[#34C759] font-bold">$</span>
                  <span className="text-white font-mono break-all">{commandOrUrl}</span>
                </div>
              )}
              <div className="text-[#D4D4D8] whitespace-pre-wrap font-sans text-xs pt-1 selection:bg-[#34C759]/30">
                {outputContent || "Minis executed commands inside the sandbox..."}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
