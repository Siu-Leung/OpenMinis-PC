import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Trash2,
  RefreshCw,
  FileText,
  Copy,
  Check,
  X,
  Download,
  AlertCircle
} from "lucide-react";

export interface LogFileInfo {
  name: string;
  size_bytes: number;
  display_size: string;
  date_str: string;
}

export interface LogsSummary {
  enabled: boolean;
  total_size_bytes: number;
  total_size_display: string;
  files: LogFileInfo[];
}

interface LogsManagerProps {
  onClose: () => void;
}

export function LogsManager({ onClose }: LogsManagerProps) {
  const [summary, setSummary] = useState<LogsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingEnabled, setLoggingEnabled] = useState(true);
  const [selectedFile, setSelectedFile] = useState<LogFileInfo | null>(null);
  const [logContent, setLogContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await invoke<LogsSummary>("get_logs_summary");
      setSummary(res);
      setLoggingEnabled(res.enabled);
    } catch (err) {
      console.error("加载日志失败:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const handleOpenFile = async (file: LogFileInfo) => {
    setSelectedFile(file);
    setLoadingContent(true);
    setCopied(false);
    try {
      const content = await invoke<string>("read_log_file", { name: file.name });
      setLogContent(content || "(日志内容为空)");
    } catch (err) {
      setLogContent(`读取日志失败: ${err}`);
    } finally {
      setLoadingContent(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm("确定要删除所有历史日志文件吗？此操作无法撤销。")) return;
    try {
      await invoke("delete_all_logs");
      loadLogs();
      setSelectedFile(null);
    } catch (err) {
      alert(`删除失败: ${err}`);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(logContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = async () => {
    if (!selectedFile) return;
    try {
      const savedPath = await invoke<string>("export_log_file", {
        name: selectedFile.name,
        content: logContent,
      });
      alert(`日志文件已成功导出至：\n${savedPath}`);
    } catch (err: any) {
      if (!err.includes("取消")) {
        alert(`导出失败: ${err}`);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 font-sans">
      <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden select-none animate-in fade-in zoom-in-95 duration-150">
        {/* 顶栏 */}
        <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-black dark:text-white hover:opacity-80 transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold text-black dark:text-white">日志</h2>
          </div>
          <button
            onClick={loadLogs}
            className="p-1.5 rounded-lg text-[#8E8E93] hover:text-black dark:hover:text-white transition"
            title="刷新日志列表"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
          {/* Section 1: 配置变更 (1:1 官方截图 077ff31dec5f9cdf5a689db26f127fe7_494efc.jpg) */}
          <div>
            <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider">
              配置变更
            </div>
            <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3.5 border border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between">
              <div>
                <div className="font-semibold text-xs text-black dark:text-white">启用日志</div>
                <div className="text-[11px] text-[#8E8E93] mt-0.5 max-w-sm leading-relaxed">
                  启用后，所有控制台输出将每天捕获到应用私有存储中的日志文件。
                </div>
              </div>
              <input
                type="checkbox"
                checked={loggingEnabled}
                onChange={e => setLoggingEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#0A84FF]"
              />
            </div>
          </div>

          {/* Section 2: 日志文件 (1:1 每日轮转列表) */}
          <div>
            <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider flex items-center justify-between">
              <span>日志文件</span>
              <span>{summary?.files.length || 0} 个文件</span>
            </div>
            <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
              {!summary || summary.files.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#8E8E93]">
                  暂无捕获的日志文件
                </div>
              ) : (
                summary.files.map(f => (
                  <div
                    key={f.name}
                    onClick={() => handleOpenFile(f)}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition select-none"
                  >
                    <div className="flex items-center gap-2.5">
                      <FileText className="w-4 h-4 text-[#0A84FF] shrink-0" />
                      <span className="font-mono text-xs text-black dark:text-white font-medium">
                        {f.name}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-[#8E8E93]">
                      {f.display_size}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="text-[11px] text-[#8E8E93] px-3 mt-1.5">
              点击文件查看内容。日志每天轮转。
            </div>
          </div>

          {/* Section 3: 存储与清理 */}
          <div>
            <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider">
              存储
            </div>
            <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3.5 border border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between">
              <button
                onClick={handleDeleteAll}
                className="font-semibold text-xs text-[#FF453A] hover:underline flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>删除所有日志</span>
              </button>
              <div className="text-xs text-[#8E8E93] font-medium">
                日志存储总量：{summary?.total_size_display || "0 B"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 查看单个日志详情弹窗 */}
      {selectedFile && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] w-full max-w-3xl rounded-[24px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#0A84FF]" />
                <span className="font-mono text-xs font-bold text-black dark:text-white">
                  {selectedFile.name}
                </span>
                <span className="text-[10px] text-[#8E8E93] font-mono">
                  ({selectedFile.display_size})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-black dark:text-white text-xs flex items-center gap-1 transition"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-[#34C759]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? "已复制" : "复制"}</span>
                </button>
                <button
                  onClick={handleExport}
                  className="px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-black dark:text-white text-xs flex items-center gap-1 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>导出</span>
                </button>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="p-1 rounded-lg text-[#8E8E93] hover:text-black dark:hover:text-white transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 bg-[#F2F2F7]/40 dark:bg-[#121214]">
              {loadingContent ? (
                <div className="py-12 text-center text-xs text-[#8E8E93] flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-[#0A84FF]" />
                  <span>正在读取日志文本...</span>
                </div>
              ) : (
                <pre className="font-mono text-xs text-[#1C1C1E] dark:text-[#D1D1D6] whitespace-pre-wrap leading-relaxed">
                  {logContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
