import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  PanelLeft,
  Plus,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  Settings as SettingsIcon,
  Search,
  Trash2,
  Terminal,
  ExternalLink,
  RotateCcw,
  Check,
  Copy,
  Brain,
  Globe,
  FileText,
  AlertTriangle,
  RefreshCw,
  X,
  CheckCircle2,
  Loader2,
  Server,
  Layers,
  Sparkles,
  Sliders,
  Clock,
  ArrowLeft,
  Lock,
  BarChart3,
  Sparkle,
  Lightbulb,
  Folder,
  SlidersHorizontal,
  Compass,
  ArrowRight
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  thinking?: string;
  thinking_duration?: number;
  tool_calls?: any;
  tool_call_id?: string;
  images?: string[];
  files?: { name: string; url: string; sizeStr?: string }[];
}

interface Provider {
  id: string;
  name: string;
  provider_url: string;
  api_key: string;
  models: string[];
}

interface AgentConfig {
  provider_id?: string;
  provider_url: string;
  api_key: string;
  model: string;
  fallback_models?: string[];
  thinking_level?: string;
  thinking_budget?: number;
}

interface StreamEvent {
  event_type: "status" | "thinking" | "token" | "tool_start" | "tool_end" | "fallback" | "error";
  content: string;
}

interface SessionRecord {
  id: string;
  title: string;
  created_at: string;
  message_count: number;
  preview: string;
}

interface ModelGroupItem {
  id: string;
  name: string;
  is_primary: boolean;
  fallback_models: string[];
  description?: string;
}

interface DefaultsConfig {
  default_primary_group: string;
  default_sub_model: string;
  voice_input: string;
  voice_output: string;
  vision_input: string;
}

interface FullModelGroupsState {
  groups: ModelGroupItem[];
  defaults: DefaultsConfig;
  agent_loop_models: { id: string; name: string; is_group: boolean; model_count: number }[];
}

interface ModelDetailMetrics {
  display_pure_input: string;
  display_output: string;
  display_cached: string;
  display_hit_rate: string;
  display_daily_avg: string;
  display_session_avg: string;
  session_count: number;
  active_days: number;
}

interface ModelUsageSummary {
  model_id: string;
  provider_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  display_input: string;
  display_output: string;
  details: ModelDetailMetrics;
}

interface TotalUsageDashboard {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cached_tokens: number;
  cache_hit_rate_pct: number;
  display_total_input: string;
  display_total_output: string;
  display_cached_read: string;
  display_hit_rate: string;
  model_rankings: ModelUsageSummary[];
}

interface McpServerItem {
  id: string;
  name: string;
  server_type: string;
  command_or_url: string;
  enabled: boolean;
  tools_count: number;
  description?: string;
}

interface AttachmentItem {
  id: string;
  name: string;
  dataUrl: string;
  isMedia: boolean;
  sizeStr: string;
}

const AVATAR_COLORS = [
  { bg: "bg-[#E8F5E9]", text: "text-[#2E7D32]" },
  { bg: "bg-[#FFF3E0]", text: "text-[#E65100]" },
  { bg: "bg-[#E1F5FE]", text: "text-[#0277BD]" },
  { bg: "bg-[#F3E5F5]", text: "text-[#7B1FA2]" },
  { bg: "bg-[#FBE9E7]", text: "text-[#D84315]" },
];

export default function App() {
  // 沙箱状态与向导
  const [sandboxReady, setSandboxReady] = useState<boolean>(true);
  const [sandboxNeedRestart, setSandboxNeedRestart] = useState<boolean>(false);
  const [showInitModal, setShowInitModal] = useState<boolean>(false);
  const [initPercent, setInitPercent] = useState<number>(0);
  const [initCurrentText, setInitCurrentText] = useState<string>("准备中...");
  const [initLogs, setInitLogs] = useState<string[]>([]);
  const [initError, setInitError] = useState<string | null>(null);

  // 侧边栏与会话
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [showTopMenu, setShowTopMenu] = useState(false);

  // 1:1 对标截图：全功能设置模态窗口及其子页面路由
  const [settingsView, setSettingsView] = useState<
    "none" | "root" | "providers" | "model_groups" | "usage" | "mcp" | "memory" | "browser_settings"
  >("none");

  // 内置独立浏览器窗口状态 (完全不依赖沙箱，开箱即用)
  const [showBrowserWindow, setShowBrowserWindow] = useState<boolean>(false);
  const [browserUrl, setBrowserUrl] = useState<string>("https://cn.bing.com");
  const [currentNavUrl, setCurrentNavUrl] = useState<string>("https://cn.bing.com");

  // 浏览器专属设置
  const [browserSettings, setBrowserSettings] = useState({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    timeoutSecs: 20,
    headlessDefault: true,
  });

  // 纯净开箱：供应商默认纯空！
  const [providers, setProviders] = useState<Provider[]>(() => {
    const saved = localStorage.getItem("openminis_providers_v4_clean");
    return saved ? JSON.parse(saved) : [];
  });
  const [activeProviderId, setActiveProviderId] = useState<string>(() => {
    return localStorage.getItem("openminis_active_provider_id_v4") || "";
  });
  const [activeModel, setActiveModel] = useState<string>(() => {
    return localStorage.getItem("openminis_active_model_v4") || "";
  });
  const [thinkingLevel, setThinkingLevel] = useState<string>(() => {
    return localStorage.getItem("openminis_thinking_level") || "high";
  });

  // 纯净开箱：模型组默认纯空！
  const [modelGroupsState, setModelGroupsState] = useState<FullModelGroupsState>({
    groups: [],
    defaults: {
      default_primary_group: "无",
      default_sub_model: "无",
      voice_input: "无",
      voice_output: "无",
      vision_input: "无"
    },
    agent_loop_models: []
  });

  // 纯净开箱：Token 用量默认纯 0！
  const [usageDashboard, setUsageDashboard] = useState<TotalUsageDashboard>({
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cached_tokens: 0,
    cache_hit_rate_pct: 0,
    display_total_input: "0",
    display_total_output: "0",
    display_cached_read: "0",
    display_hit_rate: "0.0%",
    model_rankings: []
  });

  // 对话流状态
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好，我是 **Minis**。\n\n运行于独立的 Alpine Linux 沙箱环境。支持多供应商管理、模型组自动回退、深度思考模式与真机浏览器自动化。随时提出要求！"
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<"idle" | "connecting" | "thinking" | "answering">("idle");
  const [streamingText, setStreamingText] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [thinkingDuration, setThinkingDuration] = useState<number>(0);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [fallbackToast, setFallbackToast] = useState<string | null>(null);

  // 输入框待发附件
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 折叠卡片状态
  const [expandedThinking, setExpandedThinking] = useState<Record<number, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({});
  const [expandedUsageModels, setExpandedUsageModels] = useState<Record<string, boolean>>({});
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // 顶栏下拉
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([]);
  const [memoryText, setMemoryText] = useState("");
  const [fetchingModels, setFetchingModels] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const thinkingTimerRef = useRef<any>(null);

  // 获取当前所有供应商拉取到的模型总池
  const allAvailableModels = providers.flatMap(p => p.models);
  const activeProvider = providers.find(p => p.id === activeProviderId) || providers[0];

  useEffect(() => {
    checkSandbox();
    refreshSessions();
    loadModelGroups();
    loadUsageDashboard();
    loadMcpServers();

    const unlistenStream = listen<StreamEvent>("agent-stream", (event) => {
      const payload = event.payload;
      if (payload.event_type === "status") {
        if (payload.content === "thinking") setAgentStatus("thinking");
        else if (payload.content === "answering") setAgentStatus("answering");
        else if (payload.content === "connecting") setAgentStatus("connecting");
      } else if (payload.event_type === "thinking") {
        setAgentStatus("thinking");
        setStreamingThinking(prev => prev + payload.content);
      } else if (payload.event_type === "token") {
        setAgentStatus("answering");
        setStreamingText(prev => prev + payload.content);
      } else if (payload.event_type === "tool_start") {
        setActiveToolName(payload.content);
      } else if (payload.event_type === "tool_end") {
        setActiveToolName(null);
      } else if (payload.event_type === "fallback") {
        setFallbackToast(payload.content);
        setTimeout(() => setFallbackToast(null), 5000);
      }
    });

    let unlistenWebviewDrop: (() => void) | undefined;
    try {
      getCurrentWebview().onDragDropEvent(async (event) => {
        if (event.payload.type === "drop") {
          setIsDraggingOver(false);
          const paths = event.payload.paths;
          if (paths && paths.length > 0) handleImportFilePaths(paths);
        } else if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDraggingOver(true);
        } else if (event.payload.type === "leave") {
          setIsDraggingOver(false);
        }
      }).then(fn => { unlistenWebviewDrop = fn; });
    } catch (_) {}

    return () => {
      unlistenStream.then(un => un());
      if (unlistenWebviewDrop) unlistenWebviewDrop();
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, streamingThinking, activeToolName, agentStatus, attachments]);

  useEffect(() => {
    if (agentStatus === "thinking") {
      const start = Date.now();
      thinkingTimerRef.current = setInterval(() => {
        setThinkingDuration(Math.round((Date.now() - start) / 100) / 10);
      }, 100);
    } else if (thinkingTimerRef.current) {
      clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
  }, [agentStatus]);

  const checkSandbox = async () => {
    try {
      const ready = await invoke<boolean>("check_sandbox_status");
      setSandboxReady(ready);
    } catch (_) {
      setSandboxReady(false);
    }
  };

  const loadModelGroups = async () => {
    try {
      const state = await invoke<FullModelGroupsState>("get_model_groups_state");
      setModelGroupsState(state);
    } catch (_) {}
  };

  const loadUsageDashboard = async () => {
    try {
      const dash = await invoke<TotalUsageDashboard>("get_usage_dashboard");
      setUsageDashboard(dash);
    } catch (_) {}
  };

  const loadMcpServers = async () => {
    try {
      const list = await invoke<McpServerItem[]>("list_mcp_servers");
      setMcpServers(list);
    } catch (_) {}
  };

  const refreshSessions = async () => {
    try {
      const list = await invoke<SessionRecord[]>("list_sessions");
      setSessions(list);
    } catch (_) {}
  };

  const saveProviders = (newProviders: Provider[]) => {
    setProviders(newProviders);
    localStorage.setItem("openminis_providers_v4_clean", JSON.stringify(newProviders));
  };

  const handleImportFilePaths = async (paths: string[]) => {
    try {
      const imported = await invoke<AttachmentItem[]>("import_local_files_by_path", { paths });
      setAttachments(prev => [...prev, ...imported]);
    } catch (err) {
      console.error("导入文件失败:", err);
    }
  };

  // 剪贴板图片粘贴 (Ctrl+V)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          processFile(file);
          e.preventDefault();
        }
      }
    }
  };

  const processFile = (file: File) => {
    const isMedia = file.type.startsWith("image/");
    const sizeStr = file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(file.size / 1024)} KB`;
    const reader = new FileReader();
    reader.onload = () => {
      setAttachments(prev => [
        ...prev,
        { id: Math.random().toString(36).substring(7), name: file.name, dataUrl: reader.result as string, isMedia, sizeStr }
      ]);
    };
    reader.readAsDataURL(file);
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || loading) return;

    if (!activeProvider || (!activeProvider.api_key && activeProvider.id !== "ollama")) {
      setSettingsView("providers");
      return;
    }

    const currentAttachments = [...attachments];
    setAttachments([]);

    let promptText = input.trim();
    const uploadedImages: string[] = [];
    const uploadedFiles: { name: string; url: string; sizeStr?: string }[] = [];

    for (const att of currentAttachments) {
      try {
        const minisUrl = await invoke<string>("upload_chat_attachment", {
          name: att.name,
          base64Data: att.dataUrl,
          isMedia: att.isMedia
        });
        if (att.isMedia) {
          uploadedImages.push(att.dataUrl);
          promptText += `\n\n[附带图片: ${minisUrl}]`;
        } else {
          uploadedFiles.push({ name: att.name, url: minisUrl, sizeStr: att.sizeStr });
          promptText += `\n\n[附带文件: ${minisUrl} (${att.sizeStr})]`;
        }
      } catch (err) {
        console.error("上传附件失败:", err);
      }
    }

    const userMsg: ChatMessage = {
      role: "user",
      content: promptText || "请分析已上传的图片/文件",
      images: uploadedImages.length > 0 ? uploadedImages : undefined,
      files: uploadedFiles.length > 0 ? uploadedFiles : undefined
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setLoading(true);
    setAgentStatus("connecting");
    setStreamingText("");
    setStreamingThinking("");
    setThinkingDuration(0);
    setActiveToolName(null);

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const primaryGroup = modelGroupsState.groups.find(g => g.name === modelGroupsState.defaults.default_primary_group);
    const fallbackList = primaryGroup ? primaryGroup.fallback_models : [];

    const agentCfg: AgentConfig = {
      provider_id: activeProvider.id,
      provider_url: activeProvider.provider_url,
      api_key: activeProvider.api_key,
      model: activeModel,
      fallback_models: fallbackList,
      thinking_level: thinkingLevel,
    };

    try {
      const updated = await invoke<ChatMessage[]>("run_agent_turn", {
        config: agentCfg,
        sessionId: currentSessionId,
        messages: nextHistory
      });
      setMessages(updated);
      refreshSessions();
      loadUsageDashboard();
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `⚠️ 执行出错: ${err?.toString() || "网络或服务异常"}` }
      ]);
    } finally {
      setLoading(false);
      setAgentStatus("idle");
      setStreamingText("");
      setStreamingThinking("");
      setActiveToolName(null);
    }
  };

  const getToolDisplayInfo = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      if (parsed.exit_code !== undefined) {
        return { label: "shell_execute", icon: Terminal, color: "text-[#34C759]", detail: parsed.stdout || parsed.stderr };
      }
      if (parsed.content !== undefined) {
        return { label: "file_read", icon: FileText, color: "text-[#32ADE6]", detail: parsed.content };
      }
      if (parsed.minis_url !== undefined) {
        return { label: "file_write", icon: FileText, color: "text-[#32ADE6]", detail: `已写入: ${parsed.path}` };
      }
      if (parsed.data !== undefined) {
        return { label: "browser_use", icon: Globe, color: "text-[#0A84FF]", detail: parsed.data };
      }
    } catch (_) {}
    return { label: "tool", icon: Terminal, color: "text-[#8E8E93]", detail: content };
  };

  return (
    <div 
      onDrop={e => {
        e.preventDefault();
        if (e.dataTransfer.files) {
          for (let i = 0; i < e.dataTransfer.files.length; i++) processFile(e.dataTransfer.files[i]);
        }
      }}
      onDragOver={e => e.preventDefault()}
      className="flex h-screen w-screen bg-[#F2F2F7] dark:bg-[#000000] text-[#000000] dark:text-[#FFFFFF] font-sans antialiased overflow-hidden select-none relative"
    >
      {/* 拖拽进入高亮遮罩 */}
      {isDraggingOver && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-8 border-2 border-dashed border-[#0A84FF] rounded-2xl m-3 pointer-events-none">
          <div className="flex flex-col items-center gap-3 text-center">
            <Plus className="w-10 h-10 text-[#0A84FF]" />
            <div className="text-base font-semibold text-white">松开鼠标，将文件/图片附加到会话中</div>
          </div>
        </div>
      )}

      {/* 回退提示 Toast */}
      {fallbackToast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#FF9F0A]/90 text-black text-xs font-semibold shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <AlertTriangle className="w-4 h-4" />
          <span>{fallbackToast}</span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files) {
            for (let i = 0; i < e.target.files.length; i++) processFile(e.target.files[i]);
          }
        }}
      />

      {/* =========================================================================
          1. 会话主列表 (1:1 完美复刻截图 1000143307.jpg)
      ========================================================================= */}
      {sidebarOpen && (
        <aside className="w-[300px] h-full bg-[#F7F7F9] dark:bg-[#000000] border-r border-[#E5E5EA] dark:border-[#1C1C1E] flex flex-col justify-between shrink-0 z-20">
          <div className="flex flex-col h-full min-h-0">
            {/* 顶栏：⚙️ 设置按钮 + "Minis" 标题 + 🕒 用量快捷入口 + [>_] 终端快捷入口 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E5EA] dark:border-[#1C1C1E]">
              <button
                onClick={() => setSettingsView("root")}
                className="p-1 rounded-lg text-[#1C1C1E] dark:text-[#FFFFFF] hover:bg-[#E5E5EA] dark:hover:bg-[#1C1C1E] transition"
                title="设置"
              >
                <SettingsIcon className="w-5 h-5" />
              </button>

              <h1 className="text-lg font-bold tracking-tight text-[#1C1C1E] dark:text-[#FFFFFF]">Minis</h1>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSettingsView("usage")}
                  className="p-1 rounded-lg text-[#1C1C1E] dark:text-[#FFFFFF] hover:bg-[#E5E5EA] dark:hover:bg-[#1C1C1E] transition"
                  title="Token 用量"
                >
                  <Clock className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setShowTopMenu(!showTopMenu)}
                  className="p-1 rounded-lg text-[#1C1C1E] dark:text-[#FFFFFF] hover:bg-[#E5E5EA] dark:hover:bg-[#1C1C1E] transition relative"
                  title="功能菜单"
                >
                  <Terminal className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* 右上角原生弹出菜单 (1:1 复刻截图 1000143307.jpg 菜单) */}
            {showTopMenu && (
              <div className="absolute top-14 left-44 w-44 bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-2xl shadow-2xl p-1.5 z-50 text-xs text-[#1C1C1E] dark:text-[#FFFFFF] space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                <button
                  onClick={() => { setShowTopMenu(false); invoke("launch_interactive_terminal"); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left"
                >
                  <Terminal className="w-4 h-4 text-[#8E8E93]" />
                  <span>Shell 终端</span>
                </button>
                <button
                  onClick={() => { setShowTopMenu(false); invoke("open_sandbox_dir"); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left"
                >
                  <SettingsIcon className="w-4 h-4 text-[#8E8E93]" />
                  <span>Rootfs 管理</span>
                </button>
                <button
                  onClick={() => { setShowTopMenu(false); setShowBrowserWindow(true); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left"
                >
                  <Globe className="w-4 h-4 text-[#0A84FF]" />
                  <span>打开浏览器</span>
                </button>
                <button
                  onClick={() => { setShowTopMenu(false); setSettingsView("browser_settings"); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left border-t border-[#E5E5EA] dark:border-[#2C2C2E]"
                >
                  <SettingsIcon className="w-4 h-4 text-[#8E8E93]" />
                  <span>浏览器设置</span>
                </button>
              </div>
            )}

            {/* 会话列表 */}
            <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-[#E5E5EA] dark:divide-[#1C1C1E]">
              <div className="px-4 py-2 text-[13px] font-bold text-[#8E8E93]">今天</div>
              
              {sessions.length === 0 ? (
                <div className="text-center py-10 text-xs text-[#8E8E93]">
                  暂无历史会话，点击下方新建
                </div>
              ) : (
                sessions.map((s, idx) => {
                  const colorConfig = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                  const isSelected = currentSessionId === s.id;

                  return (
                    <div
                      key={s.id}
                      onClick={() => {
                        invoke<ChatMessage[]>("get_session_messages", { id: s.id }).then(msgs => {
                          setMessages(msgs);
                          setCurrentSessionId(s.id);
                        });
                      }}
                      className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer transition ${
                        isSelected 
                          ? "bg-[#E5E5EA]/60 dark:bg-[#1C1C1E]" 
                          : "hover:bg-[#F2F2F7] dark:hover:bg-[#141416]"
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${colorConfig.bg} ${colorConfig.text}`}>
                        <Sparkle className="w-5 h-5" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-semibold text-sm text-[#1C1C1E] dark:text-[#FFFFFF] truncate">
                            {s.title}
                          </span>
                          <span className="text-[11px] text-[#8E8E93] shrink-0 font-normal">刚才</span>
                        </div>
                        <div className="text-xs text-[#8E8E93] truncate">
                          {s.preview || "暂无消息摘要"}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-4 border-t border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between">
              <button
                onClick={() => {
                  setMessages([{ role: "assistant", content: "已开启新会话。请随时下达指令！" }]);
                  setCurrentSessionId(null);
                  setInput("");
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E5E5EA] dark:bg-[#1C1C1E] text-xs font-semibold text-[#1C1C1E] dark:text-[#FFFFFF] hover:opacity-80 transition"
              >
                <Plus className="w-4 h-4" /> 新建会话
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-full bg-[#E5E5EA] dark:bg-[#1C1C1E] text-[#8E8E93] hover:text-white transition"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* =========================================================================
          2. 主聊天区
      ========================================================================= */}
      <main className="flex-1 flex flex-col h-full bg-[#F2F2F7] dark:bg-[#000000] relative">
        <header className="h-[52px] border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between px-4 shrink-0 bg-white/70 dark:bg-[#000000]/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-lg text-[#8E8E93] hover:text-[#FFFFFF] hover:bg-[#1C1C1E] transition"
              >
                <PanelLeft className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* 顶栏中心：模型与思考强度胶囊 */}
          <div className="relative">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-sm text-xs font-medium text-[#1C1C1E] dark:text-[#FFFFFF] transition"
            >
              <span className="truncate max-w-[200px]">{activeModel || "选择模型"}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#8E8E93]" />
            </button>

            {showModelPicker && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 w-80 bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-2xl shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                <div className="pb-2.5 border-b border-[#E5E5EA] dark:border-[#2C2C2E] mb-2 space-y-1.5">
                  <div className="text-[11px] font-semibold text-[#8E8E93] flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-[#0A84FF]" />
                    <span>思考模式强度 (Reasoning Effort)</span>
                  </div>
                  <div className="flex rounded-xl bg-[#F2F2F7] dark:bg-[#141416] p-1 border border-[#E5E5EA] dark:border-[#2C2C2E] text-[11px]">
                    {["off", "low", "medium", "high"].map(lvl => (
                      <button
                        key={lvl}
                        onClick={() => setThinkingLevel(lvl)}
                        className={`flex-1 py-1 rounded-lg uppercase font-semibold transition ${
                          thinkingLevel === lvl ? "bg-[#0A84FF] text-white" : "text-[#8E8E93] hover:text-white"
                        }`}
                      >
                        {lvl === "off" ? "关闭" : lvl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 纯净可用模型池 */}
                <div className="text-[11px] font-semibold text-[#8E8E93] mb-1">可用模型池</div>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {allAvailableModels.length === 0 ? (
                    <div className="text-center py-6 text-xs text-[#8E8E93] space-y-2">
                      <div>暂无可用模型</div>
                      <button
                        onClick={() => { setShowModelPicker(false); setSettingsView("providers"); }}
                        className="text-[#0A84FF] hover:underline"
                      >
                        前往设置 → 添加 AI 服务商
                      </button>
                    </div>
                  ) : (
                    allAvailableModels.map(m => (
                      <button
                        key={m}
                        onClick={() => { setActiveModel(m); setShowModelPicker(false); }}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-xs truncate transition flex items-center justify-between ${
                          activeModel === m ? "bg-[#0A84FF] text-white" : "text-[#8E8E93] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E]"
                        }`}
                      >
                        <span className="truncate">{m}</span>
                        {activeModel === m && <Check className="w-3.5 h-3.5" />}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setMessages([{ role: "assistant", content: "已开启新对话。" }]);
                setCurrentSessionId(null);
                setInput("");
              }}
              className="p-1.5 rounded-lg text-[#8E8E93] hover:text-[#FFFFFF] transition"
              title="新建对话"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* 消息滚动流 */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg, i) => {
              if (msg.role === "system") return null;

              if (msg.role === "tool") {
                const info = getToolDisplayInfo(msg.content);
                const IconComponent = info.icon;
                const isExpanded = !!expandedTools[i];

                return (
                  <div key={i} className="my-2">
                    <div
                      onClick={() => setExpandedTools(prev => ({ ...prev, [i]: !prev[i] }))}
                      className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] hover:border-[#38383A] text-xs text-[#8E8E93] cursor-pointer transition select-none shadow-sm"
                    >
                      <IconComponent className={`w-3.5 h-3.5 ${info.color}`} />
                      <span className="font-mono text-[11px] text-[#1C1C1E] dark:text-[#D1D1D6]">{info.label}</span>
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </div>

                    {isExpanded && (
                      <div className="mt-2 p-3.5 rounded-2xl bg-white dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] text-xs font-mono relative overflow-x-auto text-[#1C1C1E] dark:text-[#C7C7CC] shadow-inner">
                        <pre className="whitespace-pre-wrap selection:bg-[#2C2C2E]">{info.detail}</pre>
                      </div>
                    )}
                  </div>
                );
              }

              if (msg.role === "user") {
                return (
                  <div key={i} className="flex flex-col items-end space-y-2">
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end max-w-[80%]">
                        {msg.images.map((img, idx) => (
                          <img key={idx} src={img} alt="upload" className="max-h-56 max-w-sm rounded-2xl border border-[#2C2C2E] object-cover shadow-sm" />
                        ))}
                      </div>
                    )}

                    <div className="bg-[#E5E5EA] dark:bg-[#1C1C1E] text-[#000000] dark:text-[#FFFFFF] rounded-[22px] rounded-br-[6px] px-4 py-2.5 max-w-[80%] text-[15px] leading-relaxed shadow-sm">
                      {msg.content}
                    </div>
                  </div>
                );
              }

              return (
                <div key={i} className="flex flex-col space-y-2 text-[#1C1C1E] dark:text-[#E5E5EA] text-[15px] leading-relaxed select-text">
                  {msg.thinking && (
                    <div className="mb-1">
                      <div
                        onClick={() => setExpandedThinking(prev => ({ ...prev, [i]: !prev[i] }))}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] text-xs text-[#8E8E93] cursor-pointer transition select-none shadow-sm"
                      >
                        <Brain className="w-3.5 h-3.5 text-[#0A84FF]" />
                        <span>已思考 {msg.thinking_duration ? `${msg.thinking_duration.toFixed(1)} 秒` : ""}</span>
                        {expandedThinking[i] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </div>

                      {expandedThinking[i] && (
                        <div className="mt-2 p-3.5 rounded-2xl bg-white dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] text-xs font-mono text-[#8E8E93] leading-relaxed whitespace-pre-wrap">
                          {msg.thinking}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="prose dark:prose-invert max-w-none text-[15px] leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                </div>
              );
            })}

            {loading && streamingThinking && (
              <div className="flex flex-col space-y-2 text-[#8E8E93]">
                <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white dark:bg-[#141416] border border-[#0A84FF]/40 text-xs text-[#0A84FF] animate-pulse shadow-sm">
                  <Brain className="w-3.5 h-3.5 animate-spin" />
                  <span>正在深度思考 ({thinkingDuration.toFixed(1)}s)...</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-white dark:bg-[#141416] border border-[#2C2C2E] text-xs font-mono text-[#8E8E93] leading-relaxed whitespace-pre-wrap">
                  {streamingThinking}
                </div>
              </div>
            )}

            {loading && streamingText && (
              <div className="flex flex-col space-y-2 text-[#1C1C1E] dark:text-[#E5E5EA] text-[15px] leading-relaxed select-text">
                <div className="prose dark:prose-invert max-w-none text-[15px] leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingText}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {loading && agentStatus === "connecting" && !streamingText && !streamingThinking && (
              <div className="flex items-center gap-2 text-xs text-[#8E8E93] py-2">
                <div className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0A84FF] animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0A84FF] animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0A84FF] animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span>Minis 正在分析请求...</span>
              </div>
            )}

            {loading && activeToolName && (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white dark:bg-[#141416] border border-[#2C2C2E] text-[11px] text-[#8E8E93] animate-pulse">
                <Terminal className="w-3 h-3 text-[#34C759] animate-spin" />
                <span>{activeToolName}</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        {/* 悬浮胶囊输入框 */}
        <div className="p-4 shrink-0">
          <div className="max-w-3xl mx-auto bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-[26px] px-4 py-2.5 flex flex-col gap-2 focus-within:border-[#0A84FF] transition shadow-xl">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1 border-b border-[#E5E5EA] dark:border-[#2C2C2E] pb-2">
                {attachments.map(att => (
                  <div key={att.id} className="relative group flex items-center gap-2 p-1.5 bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-xl text-xs">
                    {att.isMedia ? (
                      <img src={att.dataUrl} alt={att.name} className="w-10 h-10 rounded-lg object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-[#2C2C2E] flex items-center justify-center">
                        <FileText className="w-5 h-5 text-[#32ADE6]" />
                      </div>
                    )}
                    <div className="max-w-[120px] truncate text-[11px] pr-3">
                      <div className="truncate text-black dark:text-white font-medium">{att.name}</div>
                      <div className="text-[10px] text-[#8E8E93]">{att.sizeStr}</div>
                    </div>
                    <button
                      onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#2C2C2E] hover:bg-[#FF453A] rounded-full flex items-center justify-center text-white transition"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#8E8E93] hover:text-black dark:hover:text-white transition shrink-0 mb-0.5"
                title="添加文件或图片"
              >
                <Plus className="w-5 h-5" />
              </button>

              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onPaste={handlePaste}
                onChange={e => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="发送给 Minis..."
                className="flex-1 bg-transparent border-none text-[15px] text-black dark:text-white placeholder-[#8E8E93] focus:outline-none resize-none max-h-40 py-1"
              />

              <button
                onClick={handleSend}
                disabled={loading || (!input.trim() && attachments.length === 0)}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition shrink-0 mb-0.5 ${
                  (input.trim() || attachments.length > 0) && !loading
                    ? "bg-[#000000] text-white dark:bg-white dark:text-black hover:opacity-90"
                    : "bg-[#E5E5EA] text-[#8E8E93] dark:bg-[#2C2C2E] dark:text-[#636366] cursor-not-allowed"
                }`}
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* =========================================================================
          3. 设置总览中心 (1:1 完美复刻截图 1000143310.jpg)
      ========================================================================= */}
      {settingsView === "root" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("none")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">设置</h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">LLM 提供商</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <div
                    onClick={() => setSettingsView("providers")}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center text-white">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">管理提供商</div>
                        <div className="text-xs text-[#8E8E93]">API key 与 OAuth 登录</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

                  <div
                    onClick={() => setSettingsView("model_groups")}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center text-white">
                        <SlidersHorizontal className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">模型组</div>
                        <div className="text-xs text-[#8E8E93]">回退与负载均衡</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

                  <div
                    onClick={() => setSettingsView("usage")}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center text-white">
                        <BarChart3 className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">Token 用量</div>
                        <div className="text-xs text-[#8E8E93]">跨提供商追踪 API 使用情况</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">AGENT 运行时</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <div
                    onClick={() => setSettingsView("mcp")}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center text-white">
                        <Layers className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">MCP 集成</div>
                        <div className="text-xs text-[#8E8E93]">连接 Model Context Protocol 服务器</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

                  <div
                    onClick={() => {
                      invoke<string>("get_today_memory").then(t => setMemoryText(t)).catch(e => setMemoryText(e));
                      setSettingsView("memory");
                    }}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#5856D6] flex items-center justify-center text-white">
                        <Lightbulb className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">记忆</div>
                        <div className="text-xs text-[#8E8E93]">跨会话保留的持久化知识</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">存储</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <div
                    onClick={() => invoke("open_sandbox_dir")}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#34C759] flex items-center justify-center text-white">
                        <Folder className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">共享文件夹</div>
                        <div className="text-xs text-[#8E8E93]">浏览 /var/minis 下的工作区与附件</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          4. AI 服务商页面 (纯净空状态 + 自行添加)
      ========================================================================= */}
      {settingsView === "providers" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("root")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">AI 服务商</h2>
              </div>
              <button
                onClick={() => {
                  const newId = `custom-${Date.now().toString(36)}`;
                  const newP = { id: newId, name: "新建供应商", provider_url: "https://api.openai.com/v1", api_key: "", models: [] };
                  const next = [...providers, newP];
                  saveProviders(next);
                  if (!activeProviderId) setActiveProviderId(newId);
                }}
                className="text-black dark:text-white p-1"
                title="添加新服务商"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {providers.length === 0 ? (
                <div className="text-center py-16 text-xs text-[#8E8E93] space-y-3">
                  <Server className="w-10 h-10 mx-auto text-[#8E8E93]/60" />
                  <div>暂无 AI 服务商，请点击右上角 <Plus className="w-4 h-4 inline" /> 添加</div>
                </div>
              ) : (
                <div>
                  <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">OPENAI / 兼容</div>
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                    {providers.map(p => (
                      <div key={p.id} className="p-4 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E]/40 transition space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span className={`w-2.5 h-2.5 rounded-full ${p.api_key ? "bg-[#34C759]" : "bg-[#FF9F0A]"} shrink-0`} />
                            <input
                              type="text"
                              value={p.name}
                              onChange={e => {
                                const val = e.target.value;
                                saveProviders(providers.map(item => item.id === p.id ? { ...item, name: val } : item));
                              }}
                              className="font-bold text-base bg-transparent border-none text-black dark:text-white focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={async () => {
                                try {
                                  const list = await invoke<string[]>("fetch_provider_models", { providerUrl: p.provider_url, apiKey: p.api_key });
                                  const updated = providers.map(item => item.id === p.id ? { ...item, models: list } : item);
                                  saveProviders(updated);
                                  if (list.length > 0 && (!activeModel || activeProviderId === p.id)) {
                                    setActiveModel(list[0]);
                                    setActiveProviderId(p.id);
                                  }
                                } catch (e) { alert(e); }
                              }}
                              className="text-xs text-[#0A84FF] hover:underline flex items-center gap-1 font-medium"
                            >
                              <RefreshCw className="w-3.5 h-3.5" /> 拉取模型
                            </button>
                            <button
                              onClick={() => {
                                const next = providers.filter(item => item.id !== p.id);
                                saveProviders(next);
                                if (activeProviderId === p.id) {
                                  setActiveProviderId(next.length > 0 ? next[0].id : "");
                                  setActiveModel(next.length > 0 && next[0].models.length > 0 ? next[0].models[0] : "");
                                }
                              }}
                              className="text-[#8E8E93] hover:text-[#FF453A] p-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="text-xs text-[#8E8E93] flex items-center justify-between">
                          <span>API Key · {p.api_key ? `${p.api_key.slice(0, 6)}...${p.api_key.slice(-4)}` : "未配置"}</span>
                          <span>{p.models.length} 个模型</span>
                        </div>

                        <div className="pt-1 flex gap-2">
                          <input
                            type="password"
                            value={p.api_key}
                            onChange={e => {
                              const val = e.target.value;
                              saveProviders(providers.map(item => item.id === p.id ? { ...item, api_key: val } : item));
                            }}
                            placeholder="填入 API Key (sk-...)"
                            className="flex-1 bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-xl px-3 py-1.5 text-xs text-black dark:text-white font-mono focus:outline-none"
                          />
                          <input
                            type="text"
                            value={p.provider_url}
                            onChange={e => {
                              const val = e.target.value;
                              saveProviders(providers.map(item => item.id === p.id ? { ...item, provider_url: val } : item));
                            }}
                            className="flex-1 bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-xl px-3 py-1.5 text-xs text-black dark:text-white font-mono focus:outline-none"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          5. 模型分组与回退 (纯净空状态)
      ========================================================================= */}
      {settingsView === "model_groups" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("root")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">模型分组</h2>
              </div>
              <button
                onClick={() => {
                  const newG: ModelGroupItem = {
                    id: `group-${Date.now().toString(36)}`,
                    name: "新分组",
                    is_primary: modelGroupsState.groups.length === 0,
                    fallback_models: allAvailableModels.slice(0, 3),
                    description: "自定义回退调度组"
                  };
                  const next = { ...modelGroupsState, groups: [...modelGroupsState.groups, newG] };
                  setModelGroupsState(next);
                  invoke("save_model_groups_state", { stateData: next });
                }}
                className="text-black dark:text-white p-1"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">分组</div>
                {modelGroupsState.groups.length === 0 ? (
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-6 border border-[#E5E5EA] dark:border-[#2C2C2E] text-center text-xs text-[#8E8E93]">
                    暂无模型分组，请点击右上角 <Plus className="w-4 h-4 inline" /> 创建
                  </div>
                ) : (
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-2 divide-y divide-[#2C2C2E]">
                    {modelGroupsState.groups.map(g => (
                      <div key={g.id} className="flex items-center justify-between pt-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-base text-black dark:text-white">{g.name}</span>
                            {g.is_primary && (
                              <span className="text-[11px] bg-[#007AFF]/15 text-[#007AFF] px-2 py-0.5 rounded-full font-medium">Primary</span>
                            )}
                          </div>
                          <div className="text-xs text-[#8E8E93]">回退 · {g.fallback_models.length} models</div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-[#8E8E93]" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">Defaults</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-3 text-xs">
                  <div>
                    <label className="block text-[#8E8E93] mb-1">Default Primary</label>
                    <select
                      value={modelGroupsState.defaults.default_primary_group}
                      onChange={e => {
                        const val = e.target.value;
                        const next = { ...modelGroupsState, defaults: { ...modelGroupsState.defaults, default_primary_group: val } };
                        setModelGroupsState(next);
                        invoke("save_model_groups_state", { stateData: next });
                      }}
                      className="w-full bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-xl px-3 py-2 text-black dark:text-white font-medium focus:outline-none"
                    >
                      <option value="无">无</option>
                      {modelGroupsState.groups.map(g => (
                        <option key={g.id} value={g.name}>{g.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          6. Token 用量仪表盘 (纯净真实 0 统计)
      ========================================================================= */}
      {settingsView === "usage" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("root")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">用量</h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">总用量</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-5 border border-[#E5E5EA] dark:border-[#2C2C2E] divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] space-y-3">
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm font-semibold text-black dark:text-white">总输入（含缓存）</span>
                    <span className="text-base font-bold text-black dark:text-white">{usageDashboard.display_total_input}</span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm font-semibold text-black dark:text-white">输出 Token</span>
                    <span className="text-base font-bold text-black dark:text-white">{usageDashboard.display_total_output}</span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm font-semibold text-black dark:text-white">缓存读取</span>
                    <span className="text-base font-bold text-black dark:text-white">{usageDashboard.display_cached_read}</span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm font-semibold text-black dark:text-white">缓存命中率</span>
                    <span className="text-base font-bold text-black dark:text-white">{usageDashboard.display_hit_rate}</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">各模型消耗排行</div>
                {usageDashboard.model_rankings.length === 0 ? (
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-6 border border-[#E5E5EA] dark:border-[#2C2C2E] text-center text-xs text-[#8E8E93]">
                    暂无模型用量记录，产生对话后自动统计
                  </div>
                ) : (
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E] overflow-hidden">
                    {usageDashboard.model_rankings.map(item => {
                      const isExpanded = !!expandedUsageModels[item.model_id];
                      return (
                        <div key={item.model_id} className="transition">
                          <div
                            onClick={() => setExpandedUsageModels(prev => ({ ...prev, [item.model_id]: !prev[item.model_id] }))}
                            className="flex items-center justify-between p-4 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E]/30 transition cursor-pointer select-none"
                          >
                            <span className="text-sm font-semibold text-black dark:text-white truncate max-w-[240px]">
                              {item.model_id}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-[#8E8E93] font-mono">
                                {item.display_input} / {item.display_output}
                              </span>
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-[#8E8E93]" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                              )}
                            </div>
                          </div>

                          {/* 1:1 原版展开指标手风琴卡片 (对标截图 1000143557/1000143558) */}
                          {isExpanded && item.details && (
                            <div className="px-6 pb-4 pt-1 space-y-2 text-xs border-t border-[#E5E5EA]/60 dark:border-[#2C2C2E]/60 bg-[#FAFAFC] dark:bg-[#161618]">
                              <div className="flex justify-between py-1 text-[#8E8E93]">
                                <span>输入</span>
                                <span className="font-mono text-black dark:text-white">{item.details.display_pure_input}</span>
                              </div>
                              <div className="flex justify-between py-1 text-[#8E8E93]">
                                <span>输出</span>
                                <span className="font-mono text-black dark:text-white">{item.details.display_output}</span>
                              </div>
                              <div className="flex justify-between py-1 text-[#8E8E93]">
                                <span>缓存读取</span>
                                <span className="font-mono text-black dark:text-white">{item.details.display_cached}</span>
                              </div>
                              <div className="flex justify-between py-1 text-[#8E8E93]">
                                <span>缓存命中率</span>
                                <span className="font-mono text-black dark:text-white">{item.details.display_hit_rate}</span>
                              </div>
                              <div className="flex justify-between py-1 text-[#8E8E93]">
                                <span>日均</span>
                                <span className="font-mono text-black dark:text-white">{item.details.display_daily_avg}</span>
                              </div>
                              <div className="flex justify-between py-1 text-[#8E8E93]">
                                <span>会话均值</span>
                                <span className="font-mono text-black dark:text-white">{item.details.display_session_avg}</span>
                              </div>
                              <div className="flex justify-between py-1 text-[#8E8E93]">
                                <span>会话</span>
                                <span className="font-mono text-black dark:text-white">{item.details.session_count}</span>
                              </div>
                              <div className="flex justify-between py-1 text-[#8E8E93]">
                                <span>活跃天数</span>
                                <span className="font-mono text-black dark:text-white">{item.details.active_days}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          7. 独立内置浏览器窗口 (完全不依赖 WSL，开箱即用)
      ========================================================================= */}
      {showBrowserWindow && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#1C1C1E] border border-[#2C2C2E] w-full max-w-4xl h-[85vh] rounded-[24px] shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-[#2C2C2E] flex items-center justify-between bg-[#141416] gap-3">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-[#0A84FF]" />
                <span className="text-xs font-semibold text-white">内置浏览器 (Edge/WebView2)</span>
              </div>

              <div className="flex-1 flex items-center gap-2 max-w-lg bg-[#1C1C1E] border border-[#2C2C2E] rounded-xl px-3 py-1">
                <input
                  type="text"
                  value={browserUrl}
                  onChange={e => setBrowserUrl(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      let u = browserUrl.trim();
                      if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
                      setCurrentNavUrl(u);
                    }
                  }}
                  className="flex-1 bg-transparent text-xs text-white focus:outline-none"
                />
                <button
                  onClick={() => {
                    let u = browserUrl.trim();
                    if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
                    setCurrentNavUrl(u);
                  }}
                  className="text-[#0A84FF] hover:text-white"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <button onClick={() => setShowBrowserWindow(false)} className="text-[#8E8E93] hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 bg-white relative">
              <iframe
                src={currentNavUrl}
                className="w-full h-full border-none"
                title="Minis Web Preview"
              />
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          8. 专门的浏览器设置面板 (不再跳到全局设置)
      ========================================================================= */}
      {settingsView === "browser_settings" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#1C1C1E] border border-[#2C2C2E] w-full max-w-md rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#2C2C2E]">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Globe className="w-4 h-4 text-[#0A84FF]" />
                <span>浏览器自动化设置</span>
              </div>
              <button onClick={() => setSettingsView("none")} className="text-[#8E8E93] hover:text-white text-xs">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[#8E8E93] mb-1">User-Agent 模拟身份</label>
                <textarea
                  rows={3}
                  value={browserSettings.userAgent}
                  onChange={e => setBrowserSettings({ ...browserSettings, userAgent: e.target.value })}
                  className="w-full bg-[#141416] border border-[#2C2C2E] rounded-xl p-2.5 text-white font-mono text-[11px] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[#8E8E93] mb-1">网页抓取超时时间 (秒)</label>
                <input
                  type="number"
                  value={browserSettings.timeoutSecs}
                  onChange={e => setBrowserSettings({ ...browserSettings, timeoutSecs: parseInt(e.target.value) || 20 })}
                  className="w-full bg-[#141416] border border-[#2C2C2E] rounded-xl px-3 py-2 text-white font-mono focus:outline-none"
                />
              </div>

              <div className="p-3 rounded-xl bg-[#141416] border border-[#2C2C2E] text-[11px] text-[#8E8E93] leading-relaxed">
                💡 浏览器自动化直接调度 Windows 宿主 Edge Headless，支持渲染 SPA 页面与生成高清网页截图，无需依赖 Linux 沙箱。
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-[#2C2C2E]">
              <button
                onClick={() => setSettingsView("none")}
                className="bg-[#0A84FF] hover:bg-[#0071E3] text-white px-5 py-1.5 rounded-full text-xs font-semibold transition"
              >
                保存并关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          9. MCP / 记忆模态框
      ========================================================================= */}
      {settingsView === "mcp" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("root")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">MCP 集成</h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                {mcpServers.map(s => (
                  <div key={s.id} className="p-4 flex items-center justify-between">
                    <div className="space-y-0.5 flex-1 pr-3">
                      <div className="font-semibold text-sm text-black dark:text-white">{s.name}</div>
                      <div className="text-xs font-mono text-[#8E8E93] truncate">{s.command_or_url}</div>
                      {s.description && <div className="text-xs text-[#8E8E93]">{s.description}</div>}
                    </div>
                    <button
                      onClick={async () => {
                        await invoke("toggle_mcp_server", { id: s.id });
                        loadMcpServers();
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                        s.enabled ? "bg-[#34C759] text-white" : "bg-[#E5E5EA] dark:bg-[#2C2C2E] text-[#8E8E93]"
                      }`}
                    >
                      {s.enabled ? "已启用" : "停用"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {settingsView === "memory" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("root")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">记忆</h2>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 border border-[#E5E5EA] dark:border-[#2C2C2E] text-xs font-mono text-[#8E8E93] whitespace-pre-wrap leading-relaxed">
                {memoryText || "今日暂无记录"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
