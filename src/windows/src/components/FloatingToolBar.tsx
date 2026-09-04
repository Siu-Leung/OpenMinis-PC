import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  StopCircle,
  Loader2,
  Monitor,
  Terminal,
  Globe,
  FileText,
  Brain,
  Clipboard,
  Bell,
  Info,
} from "lucide-react";

export interface ToolStepStatus {
  id: string;
  toolName: string;
  title: string;
  status: "running" | "success" | "failed" | "cancelled";
  toolType: "shell" | "browser" | "file" | "memory" | "clipboard" | "notification" | "info" | "other";
  commandOrUrl?: string;
  outputSnippet?: string;
}

interface FloatingToolBarProps {
  steps: ToolStepStatus[];
  onOpenDetail?: (step: ToolStepStatus) => void;
  onClose?: () => void;
}

const toolTypeIcon = (type: ToolStepStatus["toolType"]) => {
  switch (type) {
    case "shell": return Terminal;
    case "browser": return Globe;
    case "file": return FileText;
    case "memory": return Brain;
    case "clipboard": return Clipboard;
    case "notification": return Bell;
    case "info": return Info;
    default: return Monitor;
  }
};

/**
 * 浮动工具状态栏 (对标原版 FloatingToolBar / ToolStatusBar)
 * 显示在输入栏上方，展示当前工具的执行状态 + 多工具分页导航
 */
export function FloatingToolBar({ steps, onOpenDetail, onClose }: FloatingToolBarProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (!steps || steps.length === 0) return null;

  const displayedIdx = selectedIdx !== null && selectedIdx < steps.length
    ? selectedIdx
    : steps.length - 1;
  const block = steps[displayedIdx];

  const statusIcon = (() => {
    switch (block.status) {
      case "running":
        return <Loader2 className="w-4 h-4 animate-spin text-[#0A84FF]" />;
      case "success":
        return <Check className="w-4 h-4 text-[#34C759]" />;
      case "failed":
        return <X className="w-4 h-4 text-[#FF453A]" />;
      case "cancelled":
        return <StopCircle className="w-4 h-4 text-[#FF9F0A]" />;
      default:
        return null;
    }
  })();

  const Icon = toolTypeIcon(block.toolType);

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl select-none animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-[10px] bg-white dark:bg-[#262626] border border-[#D1D1D6]/30 dark:border-[#38383A]/30 shadow-[0_4px_8px_rgba(0,0,0,0.12)] dark:shadow-[0_4px_8px_rgba(0,0,0,0.6)] min-h-[38px]">
        {/* 工具类型图标 */}
        <Icon className="w-3.5 h-3.5 text-[#8E8E93] shrink-0" />

        {/* 状态图标 */}
        {statusIcon}

        {/* 标题 */}
        <span
          className="flex-1 text-[13px] font-medium text-[#8E8E93] dark:text-[#99EBEBF5] truncate cursor-pointer"
          onClick={() => onOpenDetail?.(block)}
        >
          {block.title || block.toolName}
        </span>

        {/* 多工具分页导航 */}
        {steps.length > 1 && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => setSelectedIdx(Math.max(0, displayedIdx - 1))}
              disabled={displayedIdx <= 0}
              className="w-5 h-5 flex items-center justify-center rounded text-black dark:text-white disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/10 transition"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <span className="text-[11px] font-mono text-[#8E8E93] dark:text-[#99EBEBF5]">
              {displayedIdx + 1}/{steps.length}
            </span>
            <button
              onClick={() => setSelectedIdx(Math.min(steps.length - 1, displayedIdx + 1))}
              disabled={displayedIdx >= steps.length - 1}
              className="w-5 h-5 flex items-center justify-center rounded text-black dark:text-white disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/10 transition"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
