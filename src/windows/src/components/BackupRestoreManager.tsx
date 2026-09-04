import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Archive,
  RotateCcw,
  Check,
  Shield,
  Folder,
  FileCheck,
  AlertCircle,
  Loader2,
  Lock,
  Download
} from "lucide-react";

interface BackupRestoreManagerProps {
  onClose: () => void;
  onRefreshData?: () => void;
}

export function BackupRestoreManager({ onClose, onRefreshData }: BackupRestoreManagerProps) {
  const [tab, setTab] = useState<"backup" | "restore">("backup");

  // 备份选项 (1:1 原版截图 1c4002167f2bb6ef567b9f610ab12fa1_6f24b5.jpg)
  const [includeChats, setIncludeChats] = useState(true);
  const [includeShared, setIncludeShared] = useState(true);
  const [includeSkills, setIncludeSkills] = useState(true);
  const [includeMemory, setIncludeMemory] = useState(true);
  const [includeProviders, setIncludeProviders] = useState(true);
  const [includeMcp, setIncludeMcp] = useState(true);
  const [includeEnv, setIncludeEnv] = useState(true);
  const [maxFileCap, setMaxFileCap] = useState<string>("unlimited");
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [password, setPassword] = useState("");
  const [destinationPath, setDestinationPath] = useState<string>("");

  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupSuccessMsg, setBackupSuccessMsg] = useState<string | null>(null);

  // 恢复选项 (1:1 原版截图 5487362d7e13b87916d80f2ea3bb79f4_efba80.jpg)
  const [restoreFilePath, setRestoreFilePath] = useState<string>("");
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{ success: boolean; msg: string; categories: string[] } | null>(null);

  const handlePickSavePath = async () => {
    try {
      const picked = await invoke<string | null>("pick_save_backup_path");
      if (picked) setDestinationPath(picked);
    } catch (err) {
      alert(`选择保存路径失败: ${err}`);
    }
  };

  const handleStartBackup = async () => {
    setIsBackingUp(true);
    setBackupSuccessMsg(null);
    try {
      const outPath = await invoke<string>("create_backup", {
        options: {
          include_chats: includeChats,
          include_shared: includeShared,
          include_skills: includeSkills,
          include_memory: includeMemory,
          include_providers: includeProviders,
          include_mcp: includeMcp,
          include_env: includeEnv,
          is_encrypted: isEncrypted,
          password: isEncrypted ? password : null,
          destination_path: destinationPath.trim() ? destinationPath.trim() : null,
          max_file_bytes: maxFileCap === "50MB" ? 50 * 1024 * 1024 : maxFileCap === "100MB" ? 100 * 1024 * 1024 : null,
        }
      });
      setBackupSuccessMsg(`备份完成！已导出文件：${outPath}`);
    } catch (err: any) {
      alert(`备份失败: ${err}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handlePickRestoreFile = async () => {
    try {
      const picked = await invoke<string | null>("pick_backup_file");
      if (picked) {
        setRestoreFilePath(picked);
        setRestoreResult(null);
      }
    } catch (err) {
      alert(`选择备份文件失败: ${err}`);
    }
  };

  const handleStartRestore = async () => {
    if (!restoreFilePath) {
      alert("请先选择一个 .minisbak 备份文件！");
      return;
    }
    if (!confirm("确定要从此备份中恢复数据吗？现有对应项目可能会被备份中的数据覆盖更新。")) return;

    setIsRestoring(true);
    setRestoreResult(null);
    try {
      const res = await invoke<{ success: boolean; message: string; restored_categories: string[] }>("restore_backup", {
        filePath: restoreFilePath,
      });
      setRestoreResult({
        success: res.success,
        msg: res.message,
        categories: res.restored_categories,
      });
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      setRestoreResult({
        success: false,
        msg: `恢复失败: ${err}`,
        categories: [],
      });
    } finally {
      setIsRestoring(false);
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
            <h2 className="text-lg font-bold text-black dark:text-white">备份与恢复</h2>
          </div>
        </div>

        {/* 分段 Tab 控制器 (1:1 对标原版) */}
        <div className="p-4 pb-0 bg-[#F2F2F7] dark:bg-[#000000]">
          <div className="flex rounded-2xl bg-[#E5E5EA] dark:bg-[#1C1C1E] p-1 border border-[#E5E5EA] dark:border-[#2C2C2E] text-xs">
            <button
              onClick={() => setTab("backup")}
              className={`flex-1 py-1.5 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
                tab === "backup" ? "bg-white dark:bg-[#2C2C2E] text-black dark:text-white shadow-sm" : "text-[#8E8E93] hover:text-black dark:hover:text-white"
              }`}
            >
              <Archive className="w-4 h-4" />
              <span>备份</span>
            </button>
            <button
              onClick={() => setTab("restore")}
              className={`flex-1 py-1.5 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
                tab === "restore" ? "bg-white dark:bg-[#2C2C2E] text-black dark:text-white shadow-sm" : "text-[#8E8E93] hover:text-black dark:hover:text-white"
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              <span>恢复</span>
            </button>
          </div>
        </div>

        {/* =========================================================================
            Tab 1: 备份视图 (1:1 截图 1c4002167f2bb6ef567b9f610ab12fa1_6f24b5.jpg)
        ========================================================================= */}
        {tab === "backup" && (
          <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
            {/* 包含内容 */}
            <div>
              <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider">
                包含内容
              </div>
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                <div className="flex items-center justify-between p-3.5">
                  <div>
                    <div className="font-semibold text-xs text-black dark:text-white">对话</div>
                    <div className="text-[11px] text-[#8E8E93]">对话包含每次会话中的所有文件，而不仅是消息。</div>
                  </div>
                  <input type="checkbox" checked={includeChats} onChange={e => setIncludeChats(e.target.checked)} className="w-4 h-4 accent-[#0A84FF]" />
                </div>
                <div className="flex items-center justify-between p-3.5">
                  <span className="font-semibold text-xs text-black dark:text-white">共享文件</span>
                  <input type="checkbox" checked={includeShared} onChange={e => setIncludeShared(e.target.checked)} className="w-4 h-4 accent-[#0A84FF]" />
                </div>
                <div className="flex items-center justify-between p-3.5">
                  <span className="font-semibold text-xs text-black dark:text-white">技能</span>
                  <input type="checkbox" checked={includeSkills} onChange={e => setIncludeSkills(e.target.checked)} className="w-4 h-4 accent-[#0A84FF]" />
                </div>
                <div className="flex items-center justify-between p-3.5">
                  <span className="font-semibold text-xs text-black dark:text-white">记忆与灵魂</span>
                  <input type="checkbox" checked={includeMemory} onChange={e => setIncludeMemory(e.target.checked)} className="w-4 h-4 accent-[#0A84FF]" />
                </div>
                <div className="flex items-center justify-between p-3.5">
                  <span className="font-semibold text-xs text-black dark:text-white">AI 服务商</span>
                  <input type="checkbox" checked={includeProviders} onChange={e => setIncludeProviders(e.target.checked)} className="w-4 h-4 accent-[#0A84FF]" />
                </div>
                <div className="flex items-center justify-between p-3.5">
                  <span className="font-semibold text-xs text-black dark:text-white">MCP 服务器</span>
                  <input type="checkbox" checked={includeMcp} onChange={e => setIncludeMcp(e.target.checked)} className="w-4 h-4 accent-[#0A84FF]" />
                </div>
                <div className="flex items-center justify-between p-3.5">
                  <span className="font-semibold text-xs text-black dark:text-white">环境变量</span>
                  <input type="checkbox" checked={includeEnv} onChange={e => setIncludeEnv(e.target.checked)} className="w-4 h-4 accent-[#0A84FF]" />
                </div>
                <div className="flex items-center justify-between p-3.5">
                  <span className="font-semibold text-xs text-black dark:text-white">单文件大小上限</span>
                  <select
                    value={maxFileCap}
                    onChange={e => setMaxFileCap(e.target.value)}
                    className="bg-[#F2F2F7] dark:bg-[#2C2C2E] border border-[#E5E5EA] dark:border-[#3A3A3C] rounded-lg px-2.5 py-1 text-xs text-black dark:text-white outline-none font-medium"
                  >
                    <option value="unlimited">不限制 ^</option>
                    <option value="50MB">50 MB</option>
                    <option value="100MB">100 MB</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 加密安全 */}
            <div>
              <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider">
                加密
              </div>
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3.5 border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-[#0A84FF]" />
                    <span className="font-semibold text-xs text-black dark:text-white">加密备份</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={isEncrypted}
                    onChange={e => setIsEncrypted(e.target.checked)}
                    className="w-4 h-4 accent-[#0A84FF]"
                  />
                </div>
                <div className="text-[11px] text-[#8E8E93] leading-relaxed">
                  此备份包含你的 API 密钥、OAuth 令牌和环境变量的值，且未加密 —— 任何拿到该文件的人都能读取。开启加密可保护它。
                </div>
                {isEncrypted && (
                  <input
                    type="password"
                    placeholder="输入解密密码"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full mt-2 px-3 py-1.5 rounded-xl bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] text-black dark:text-white text-xs outline-none"
                  />
                )}
              </div>
            </div>

            {/* 存储目的地 */}
            <div>
              <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider">
                存储目的地
              </div>
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3.5 border border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <div className="font-semibold text-xs text-black dark:text-white truncate">
                    {destinationPath || "默认个人文档 (Documents)"}
                  </div>
                  <div className="text-[11px] text-[#8E8E93]">将导出为标准的 .minisbak 备份包</div>
                </div>
                <button
                  onClick={handlePickSavePath}
                  className="px-3 py-1.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-black dark:text-white text-xs font-semibold hover:opacity-80 transition shrink-0"
                >
                  管理目的地 →
                </button>
              </div>
            </div>

            {backupSuccessMsg && (
              <div className="p-3.5 rounded-2xl bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/30 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                <span className="font-medium break-all">{backupSuccessMsg}</span>
              </div>
            )}

            {/* 开始备份按钮 */}
            <button
              onClick={handleStartBackup}
              disabled={isBackingUp}
              className="w-full py-3 rounded-2xl bg-[#34C759] hover:bg-[#34C759]/90 text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isBackingUp ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>正在打包备份...</span>
                </>
              ) : (
                <>
                  <Archive className="w-4 h-4" />
                  <span>开始备份</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* =========================================================================
            Tab 2: 恢复视图 (1:1 截图 5487362d7e13b87916d80f2ea3bb79f4_efba80.jpg)
        ========================================================================= */}
        {tab === "restore" && (
          <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
            <div>
              <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider">
                其他来源
              </div>
              <div
                onClick={handlePickRestoreFile}
                className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 border border-[#E5E5EA] dark:border-[#2C2C2E] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition select-none flex items-center justify-between shadow-sm"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-10 h-10 rounded-xl bg-[#0A84FF]/10 text-[#0A84FF] flex items-center justify-center shrink-0 font-bold">
                    <Folder className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-black dark:text-white truncate">
                      {restoreFilePath ? restoreFilePath.split(/[\/\\]/).pop() : "选择备份文件 →"}
                    </div>
                    <div className="text-[11px] text-[#8E8E93] truncate">
                      {restoreFilePath || "从「文件」、云盘或任意已连接的存储中选择一个 .minisbak 文件。"}
                    </div>
                  </div>
                </div>
                <Download className="w-4 h-4 text-[#8E8E93] shrink-0" />
              </div>
            </div>

            {restoreResult && (
              <div
                className={`p-4 rounded-2xl text-xs space-y-1.5 ${
                  restoreResult.success
                    ? "bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/30"
                    : "bg-[#FF453A]/10 text-[#FF453A] border border-[#FF453A]/30"
                }`}
              >
                <div className="font-bold flex items-center gap-1.5 text-sm">
                  {restoreResult.success ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  <span>{restoreResult.msg}</span>
                </div>
                {restoreResult.categories.length > 0 && (
                  <div className="text-[11px] opacity-90">
                    已成功恢复类别：{restoreResult.categories.join("、")}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleStartRestore}
              disabled={isRestoring || !restoreFilePath}
              className="w-full py-3 rounded-2xl bg-[#0A84FF] hover:bg-[#0A84FF]/90 text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {isRestoring ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>正在解压恢复数据...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" />
                  <span>开始恢复数据</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
