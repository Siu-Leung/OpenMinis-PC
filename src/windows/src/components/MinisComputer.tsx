import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Monitor,
  Terminal,
  Globe,
  Maximize2,
  Minimize2,
  X,
  ExternalLink,
  CheckCircle2,
  Play,
  RotateCcw,
  ShieldAlert,
  Loader2
} from "lucide-react";

export interface MinisComputerState {
  isActive: boolean;
  toolType: "shell" | "browser" | "file" | "other";
  title: string;
  commandOrUrl: string;
  outputSnippet?: string;
  previewImageUrl?: string;
  elapsedSecs?: number;
  canTakeover?: boolean;
}

interface MinisComputerProps {
  computerState: MinisComputerState;
  onTakeover: (url: string) => void;
  onExpand: () => void;
  onClose: () => void;
}

export function MinisComputer({
  computerState,
  onTakeover,
  onExpand,
  onClose,
}: MinisComputerProps) {
  const [minimized, setMinimized] = useState(false);
  const [timer, setTimer] = useState(0);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  // 把 minis:// 协议路径转成 data URL (webview 不能直接加载自定义协议)
  useEffect(() => {
    if (!computerState.previewImageUrl) {
      setPreviewDataUrl(null);
      return;
    }
    if (
      computerState.previewImageUrl.startsWith("data:") ||
      computerState.previewImageUrl.startsWith("http://") ||
      computerState.previewImageUrl.startsWith("https://")
    ) {
      setPreviewDataUrl(computerState.previewImageUrl);
      return;
    }
    let isMounted = true;
    invoke<string>("read_image_data_url", { pathOrUrl: computerState.previewImageUrl })
      .then(url => {
        if (isMounted) setPreviewDataUrl(url);
      })
      .catch(() => {
        if (isMounted) setPreviewDataUrl(null);
      });
    return () => {
      isMounted = false;
    };
  }, [computerState.previewImageUrl]);

  useEffect(() => {
    let interval: any;
    if (computerState.isActive) {
      setTimer(0);
      interval = setInterval(() => {
        setTimer(t => t + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [computerState.isActive, computerState.commandOrUrl]);

  if (!computerState.isActive && !computerState.outputSnippet && !computerState.previewImageUrl) {
    return null;
  }

  const isBrowser = computerState.toolType === "browser" || computerState.commandOrUrl.startsWith("http");

  return (
    <div className="fixed bottom-24 left-6 z-40 select-none animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="bg-[#1C1C1E] border border-[#2C2C2E] text-white rounded-[22px] shadow-2xl overflow-hidden w-72 md:w-80 flex flex-col font-sans transition-all">
        {/* 顶部标题栏 (1:1 官方 Minis Computer) */}
        <div className="px-3.5 py-2.5 bg-[#2C2C2E]/80 backdrop-blur-md flex items-center justify-between border-b border-[#3A3A3C]">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-[#34C759] shadow-[0_0_8px_#34C759] animate-pulse" />
            <span className="font-bold text-xs tracking-tight text-white truncate">
              Minis Computer
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* 🛑 手动介入按钮 (跳过验证码 / 扫码登录) */}
            {isBrowser && (
              <button
                onClick={() => onTakeover(computerState.commandOrUrl)}
                className="px-2 py-0.5 rounded-lg bg-[#FF9F0A] hover:bg-[#FF9F0A]/90 text-black text-[10px] font-bold transition flex items-center gap-1 shadow-sm"
                title="弹出互动浏览器，手动处理验证码或登录"
              >
                <ShieldAlert className="w-3 h-3" />
                <span>手动介入</span>
              </button>
            )}

            <button
              onClick={onExpand}
              className="p-1 rounded-lg text-[#8E8E93] hover:text-white hover:bg-white/10 transition"
              title="放大完整视图"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setMinimized(!minimized)}
              className="p-1 rounded-lg text-[#8E8E93] hover:text-white hover:bg-white/10 transition"
              title={minimized ? "展开" : "最小化"}
            >
              {minimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onClose}
              className="p-1 rounded-lg text-[#8E8E93] hover:text-white hover:bg-white/10 transition"
              title="关闭画中画"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 画中画内容体 */}
        {!minimized && (
          <div className="bg-[#0C0C0E] p-2.5 flex flex-col gap-2 min-h-[140px] max-h-[190px] overflow-hidden">
            {isBrowser ? (
              // 浏览器画中画视图 (1:1 截图 a1920f4f411af350c63388f38cc03f27_7decdf.jpg)
              <div className="flex-1 flex flex-col rounded-xl overflow-hidden border border-[#2C2C2E] bg-black/50">
                {/* 迷你地址栏 */}
                <div className="px-2 py-1 bg-[#1C1C1E] border-b border-[#2C2C2E] flex items-center gap-1.5 text-[10px] text-[#8E8E93] truncate">
                  <Globe className="w-3 h-3 text-[#32ADE6] shrink-0" />
                  <span className="font-mono truncate">{computerState.commandOrUrl || "https://www.baidu.com"}</span>
                </div>

                {/* 网页实时预览截图 */}
                <div className="flex-1 relative flex items-center justify-center bg-[#141416] overflow-hidden">
                  {previewDataUrl ? (
                    <img
                      src={previewDataUrl}
                      alt="Live Page"
                      className="w-full h-full object-cover object-top"
                    />
                  ) : (
                    <div className="text-center p-3 space-y-1">
                      <Loader2 className="w-5 h-5 animate-spin text-[#32ADE6] mx-auto" />
                      <div className="text-[10px] text-[#8E8E93]">正在后台渲染网页画面...</div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              // 终端控制台画中画视图 (1:1 截图 3f5239bd278b55fdea10f4024fbcb65f_09f6eb.jpg)
              <div className="flex-1 rounded-xl p-2.5 bg-black border border-[#2C2C2E] font-mono text-[11px] text-[#34C759] overflow-y-auto leading-relaxed space-y-1">
                <div className="text-[#8E8E93] flex items-center gap-1.5 text-[10px] pb-1 border-b border-white/5">
                  <Terminal className="w-3 h-3 text-[#34C759]" />
                  <span>Alpine Linux (WSL2) Session</span>
                </div>
                <div className="text-white flex items-center gap-1">
                  <span className="text-[#34C759] font-bold">$</span>
                  <span className="truncate">{computerState.commandOrUrl || "minis-open --help"}</span>
                </div>
                <div className="text-[#A1A1AA] text-[10px] whitespace-pre-wrap font-sans">
                  {computerState.outputSnippet || "Minis is executing commands inside container..."}
                </div>
              </div>
            )}

            {/* 状态描述条 (1:1 截图 Minis is using Browser / Shell) */}
            <div className="px-1 flex items-center justify-between text-[11px] text-[#8E8E93]">
              <div className="flex items-center gap-1.5 truncate pr-2">
                <span className="font-semibold text-[#0A84FF]">
                  Minis is using {isBrowser ? "Browser" : "Shell"}
                </span>
                <span>·</span>
                <span className="truncate">{computerState.title || "正在处理任务"}</span>
              </div>
              <span className="font-mono text-[10px] shrink-0 text-[#8E8E93]">
                {timer}s
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
