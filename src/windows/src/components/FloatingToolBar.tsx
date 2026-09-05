import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Loader2,
  Terminal,
  Globe,
  FileCode,
  Brain,
  ShieldAlert,
  Monitor,
  Sparkles
} from "lucide-react";

export interface ToolStepStatus {
  id: string;
  toolName: string;
  title: string;
  status: "running" | "success" | "failed" | "cancelled";
  toolType: "shell" | "browser" | "file" | "memory" | "clipboard" | "notification" | "info" | "other";
  commandOrUrl?: string;
  outputSnippet?: string;
  previewImageUrl?: string;
}

interface FloatingToolBarProps {
  steps: ToolStepStatus[];
  onOpenDetail?: (step: ToolStepStatus) => void;
  onTakeover?: (url: string) => void;
}

export function FloatingToolBar({ steps, onOpenDetail, onTakeover }: FloatingToolBarProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [resolvedDataUrl, setResolvedDataUrl] = useState<string | null>(null);

  const hasSteps = steps && steps.length > 0;

  // 默认展示最新步骤；若用户手动切页则显示选中步
  const displayedIdx = hasSteps
    ? (selectedIdx !== null && selectedIdx < steps.length ? selectedIdx : steps.length - 1)
    : 0;

  // 兜底准备：当没有具体执行步骤时，小电脑呈现常驻待命状态
  const fallbackStep: ToolStepStatus = {
    id: "idle-computer",
    toolName: "minis_computer",
    title: "Minis Computer",
    status: "success",
    toolType: "shell",
    commandOrUrl: "minis-status --ready",
    outputSnippet: "Alpine Linux (WSL2) sandbox is hot and ready.",
  };

  const current = hasSteps ? steps[displayedIdx] : fallbackStep;
  const isRunning = current.status === "running";

  // 解析 minis:// 图片为可直接渲染的 Data URL
  useEffect(() => {
    if (!current.previewImageUrl) {
      setResolvedDataUrl(null);
      return;
    }
    if (
      current.previewImageUrl.startsWith("data:") ||
      current.previewImageUrl.startsWith("http://") ||
      current.previewImageUrl.startsWith("https://")
    ) {
      setResolvedDataUrl(current.previewImageUrl);
      return;
    }
    let isMounted = true;
    invoke<string>("read_image_data_url", { pathOrUrl: current.previewImageUrl })
      .then(url => {
        if (isMounted) setResolvedDataUrl(url);
      })
      .catch(() => {
        if (isMounted) setResolvedDataUrl(null);
      });
    return () => {
      isMounted = false;
    };
  }, [current.previewImageUrl]);

  return (
    <div className="mx-auto mb-3 w-full max-w-3xl relative select-none animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* =========================================================================
          1. 左侧悬浮微型小电视视窗 (ToolPreviewThumbnail，100x65dp 原版经典比例)
      ========================================================================= */}
      <div
        onClick={() => onOpenDetail?.(current)}
        className="absolute -top-7 left-3 z-10 w-[104px] h-[68px] rounded-xl bg-[#141416] border border-[#2C2C2E] shadow-2xl overflow-hidden cursor-pointer hover:border-[#0A84FF] transition-all group flex flex-col"
        title="点击放大 Minis Computer 实时视窗"
      >
        {current.toolType === "browser" ? (
          <div className="flex-1 w-full h-full relative bg-black flex items-center justify-center overflow-hidden">
            {resolvedDataUrl ? (
              <img
                src={resolvedDataUrl}
                alt="Web Preview"
                className="w-full h-full object-cover object-top"
              />
            ) : current.outputSnippet ? (
              <div className="p-1.5 text-[8px] font-mono text-[#D1D1D6] leading-tight line-clamp-4">
                {current.outputSnippet}
              </div>
            ) : (
              <div className="text-center p-1">
                <Globe className="w-5 h-5 text-[#32ADE6]/70 mx-auto animate-pulse" />
                <div className="text-[7px] text-[#8E8E93] mt-0.5">加载页面中...</div>
              </div>
            )}
            {/* 拟物化迷你地址栏 */}
            <div className="absolute top-1 left-1.5 right-1.5 flex items-center gap-1 bg-black/70 backdrop-blur-sm px-1 py-0.5 rounded text-[7px] text-[#8E8E93]">
              <Globe className="w-2 h-2 text-[#32ADE6] shrink-0" />
              <span className="truncate">{current.commandOrUrl || "https://..."}</span>
            </div>
          </div>
        ) : current.toolType === "shell" ? (
          <div className="flex-1 w-full h-full p-1.5 bg-black flex flex-col justify-between font-mono">
            <div className="text-[8px] text-[#34C759] truncate flex items-center gap-0.5">
              <span className="font-bold">$</span>
              <span className="text-white/80 truncate">{current.commandOrUrl || "minis"}</span>
            </div>
            <div className="text-[7px] text-[#34C759]/80 leading-tight line-clamp-3 font-mono">
              {current.outputSnippet || "Alpine Linux sandbox active..."}
            </div>
            {/* 模拟 CPU / MEM HUD 缎带 (1:1 原版质感) */}
            <div className="text-[6px] text-white/50 bg-white/10 px-1 py-0.5 rounded flex justify-between tracking-tighter">
              <span>CPU {isRunning ? "4.2%" : "0.0%"}</span>
              <span>MEM 128M</span>
            </div>
          </div>
        ) : current.toolType === "file" ? (
          <div className="flex-1 w-full h-full bg-[#1C1C1E] p-1.5 flex flex-col justify-between">
            <div className="flex items-center gap-1 text-[8px] text-[#FF9F0A]">
              <FileCode className="w-2.5 h-2.5" />
              <span className="truncate font-mono">{current.commandOrUrl || "file"}</span>
            </div>
            <div className="text-[7px] font-mono text-[#8E8E93] line-clamp-3 leading-tight">
              {current.outputSnippet || "Reading / Writing buffer..."}
            </div>
          </div>
        ) : (
          <div className="flex-1 w-full h-full bg-[#1C1C1E] p-1.5 flex flex-col items-center justify-center text-center">
            <Monitor className="w-5 h-5 text-[#8E8E93]/70 mb-1" />
            <span className="text-[8px] font-mono text-[#8E8E93] truncate max-w-[90px]">
              {current.title}
            </span>
          </div>
        )}
      </div>

      {/* =========================================================================
          2. 状态胶囊条 (左侧 pl-[124px] 预留出小电视空间)
      ========================================================================= */}
      <div className="flex items-center gap-2 pl-[124px] pr-3 py-1.5 rounded-[12px] bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-md border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-xl min-h-[44px]">
        {/* 状态指示器 */}
        {isRunning ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0A84FF] shrink-0" />
        ) : current.status === "success" ? (
          <div className="w-2 h-2 rounded-full bg-[#34C759] shadow-[0_0_6px_#34C759] shrink-0" />
        ) : (
          <X className="w-3.5 h-3.5 text-[#FF453A] shrink-0" />
        )}

        {/* 工具描述与执行目标 */}
        <div
          className="flex-1 min-w-0 cursor-pointer flex items-center gap-1.5"
          onClick={() => onOpenDetail?.(current)}
        >
          <span className="text-xs font-semibold text-black dark:text-white truncate">
            {hasSteps ? (current.title || current.toolName) : "Minis Computer · 沙箱常驻就绪"}
          </span>
          {current.commandOrUrl && hasSteps && (
            <span className="text-[10px] font-mono text-[#8E8E93] truncate hidden sm:inline">
              · {current.commandOrUrl}
            </span>
          )}
        </div>

        {/* 快捷接管按钮 (浏览器场景) */}
        {current.toolType === "browser" && current.commandOrUrl && onTakeover && (
          <button
            onClick={() => onTakeover(current.commandOrUrl!)}
            className="px-2 py-0.5 rounded-lg bg-[#FF9F0A]/15 hover:bg-[#FF9F0A]/25 text-[#FF9F0A] text-[10px] font-semibold transition flex items-center gap-1 shrink-0"
            title="在内置浏览器中打开，手动处理验证码或登录"
          >
            <ShieldAlert className="w-3 h-3" />
            <span>接管</span>
          </button>
        )}

        {/* 多步骤分页切换 */}
        {hasSteps && steps.length > 1 && (
          <div className="flex items-center gap-1 border-l border-[#E5E5EA] dark:border-white/10 pl-2 shrink-0">
            <button
              onClick={() => setSelectedIdx(Math.max(0, displayedIdx - 1))}
              disabled={displayedIdx <= 0}
              className="p-1 rounded text-[#8E8E93] hover:text-black dark:hover:text-white disabled:opacity-20 transition"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-[#8E8E93]">
              {displayedIdx + 1}/{steps.length}
            </span>
            <button
              onClick={() => setSelectedIdx(Math.min(steps.length - 1, displayedIdx + 1))}
              disabled={displayedIdx >= steps.length - 1}
              className="p-1 rounded text-[#8E8E93] hover:text-black dark:hover:text-white disabled:opacity-20 transition"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
