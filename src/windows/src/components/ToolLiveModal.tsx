import React, { useState } from "react";
import { X, Check, Copy, Terminal, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

interface ToolLiveModalProps {
  toolInfo: {
    name: string;
    label: string;
    icon: any;
    color: string;
    content: string;
    detail: string;
  };
  onClose: () => void;
}

export function ToolLiveModal({ toolInfo, onClose }: ToolLiveModalProps) {
  const [copied, setCopied] = useState(false);
  const IconComponent = toolInfo.icon;

  const handleCopy = () => {
    navigator.clipboard.writeText(toolInfo.detail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#F2F2F7] dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] w-full max-w-2xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 标题顶栏 */}
        <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#2C2C2E] flex items-center justify-center">
              <IconComponent className={`w-4 h-4 ${toolInfo.color}`} />
            </div>
            <div>
              <div className="text-sm font-bold text-black dark:text-white flex items-center gap-2">
                <span>{toolInfo.label}</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] text-[#8E8E93]">
                  {toolInfo.name}
                </span>
              </div>
              <div className="text-xs text-[#8E8E93]">Alpine Linux 沙箱工具执行快照</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#E5E5EA] dark:bg-[#2C2C2E] text-xs font-semibold text-black dark:text-white hover:opacity-80 transition"
              title="复制全部执行日志"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#34C759]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "已复制" : "复制"}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-[#8E8E93] hover:text-black dark:hover:text-white hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E] transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 内容展示区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs">
          <div className="bg-[#141416] border border-[#2C2C2E] rounded-2xl p-4 text-[#D4D4D8] overflow-x-auto shadow-inner">
            <pre className="whitespace-pre-wrap leading-relaxed selection:bg-[#3F3F46]">
              {toolInfo.detail}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
