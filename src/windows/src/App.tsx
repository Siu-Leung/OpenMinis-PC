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
  Power,
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
  Palette,
  Sparkle,
  Lightbulb,
  Cpu,
  Key,
  Folder,
  FolderUp,
  Shield,
  BatteryCharging,
  FileCode,
  Info,
  MoreVertical,
  SlidersHorizontal
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

interface ModelUsageSummary {
  model_id: string;
  provider_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  display_input: string;
  display_output: string;
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

// 模拟原版彩色马卡龙徽章配置
const AVATAR_COLORS = [
  { bg: "bg-[#E8F5E9]", text: "text-[#2E7D32]", icon: "chat" },
  { bg: "bg-[#FFF3E0]", text: "text-[#E65100]", icon: "code" },
  { bg: "bg-[#E1F5FE]", text: "text-[#0277BD]", icon: "gear" },
  { bg: "bg-[#F3E5F5]", text: "text-[#7B1FA2]", icon: "brain" },
  { bg: "bg-[#FBE9E7]", text: "text-[#D84315]", icon: "tool" },
];

export default function App() {
  // 沙箱与状态
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
    "none" | "root" | "providers" | "model_groups" | "usage" | "mcp" | "memory" | "soul"
  >("none");

  // 数据源：供应商、模型组、用量仪表盘
  const [providers, setProviders] = useState<Provider[]>(() => {
    const saved = localStorage.getItem("openminis_providers_v3");
    return saved ? JSON.parse(saved) : [
      {
        id: "Ds",
        name: "Ds",
        provider_url: "https://api.deepseek.com",
        api_key: "",
        models: ["deepseek-chat", "deepseek-reasoner"]
      },
      {
        id: "AU",
        name: "AU",
        provider_url: "https://api.openai.com/v1",
        api_key: "",
        models: ["gemini-3.8-flash-high", "gpt-5.5", "deepseek-v4-flash", "deepseek-v4-pro", "gemini-2.5-flash"]
      },
      {
        id: "HT",
        name: "HT",
        provider_url: "https://api.openai.com/v1",
        api_key: "",
        models: ["gpt-4o", "gpt-4o-mini", "o3-mini"]
      },
      {
        id: "Siu1",
        name: "Siu1",
        provider_url: "https://api.openai.com/v1",
        api_key: "",
        models: ["gemini-3.8-flash-high", "gemini-3.7-flash-high"]
      }
    ];
  });

  const [modelGroupsState, setModelGroupsState] = useState<FullModelGroupsState>({
    groups: [
      {
        id: "group-au",
        name: "AU",
        is_primary: true,
        fallback_models: ["gemini-3.8-flash-high", "gpt-5.5", "deepseek-v4-flash", "deepseek-v4-pro", "gemini-2.5-flash"],
        description: "主力自动回退调度组 (5 models)"
      }
    ],
    defaults: {
      default_primary_group: "AU",
      default_sub_model: "无",
      voice_input: "无",
      voice_output: "无",
      vision_input: "无"
    },
    agent_loop_models: [
      { id: "loop-au", name: "AU", is_group: true, model_count: 5 }
    ]
  });

  const [usageDashboard, setUsageDashboard] = useState<TotalUsageDashboard>({
    total_input_tokens: 1601300000,
    total_output_tokens: 4900000,
    total_cached_tokens: 1387200000,
    cache_hit_rate_pct: 86.6,
    display_total_input: "1601.3M",
    display_total_output: "4.9M",
    display_cached_read: "1387.2M",
    display_hit_rate: "86.6%",
    model_rankings: [
      { model_id: "gpt-5.6-sol", provider_id: "OPENAI", prompt_tokens: 404500000, completion_tokens: 571700, cached_tokens: 380000000, display_input: "404.5M", display_output: "571.7k" },
      { model_id: "gemini-3.8-flash-high", provider_id: "OPENAI", prompt_tokens: 195900000, completion_tokens: 338100, cached_tokens: 170000000, display_input: "195.9M", display_output: "338.1k" },
      { model_id: "GPT-5.5", provider_id: "OPENAI", prompt_tokens: 169400000, completion_tokens: 839700, cached_tokens: 140000000, display_input: "169.4M", display_output: "839.7k" },
      { model_id: "gemini-3.7-flash-high", provider_id: "OPENAI", prompt_tokens: 157700000, completion_tokens: 685000, cached_tokens: 135000000, display_input: "157.7M", display_output: "685.0k" },
      { model_id: "deepseek-v4-flash", provider_id: "OPENAI", prompt_tokens: 149400000, completion_tokens: 560800, cached_tokens: 125000000, display_input: "149.4M", display_output: "560.8k" },
      { model_id: "deepseek-v4-pro", provider_id: "OPENAI", prompt_tokens: 30700000, completion_tokens: 140300, cached_tokens: 25000000, display_input: "30.7M", display_output: "140.3k" },
    ]
  });

  const [activeModel, setActiveModel] = useState<string>("gemini-3.8-flash-high");
  const [thinkingLevel, setThinkingLevel] = useState<string>("high");

  // 对话流状态
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好，我是 **Minis**。\n\n运行于独立的 Alpine Linux 沙箱，已配置多模型组自动回退与真实 Token 统计跟踪。"
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
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // 顶栏下拉
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([]);
  const [memoryText, setMemoryText] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const thinkingTimerRef = useRef<any>(null);

  useEffect(() => {
    checkSandbox();
    refreshSessions();
    loadModelGroups();
    loadUsageDashboard();
    loadMcpServers();

    // 监听实时流式事件
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

    // 监听原生拖拽
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
      if (dash.total_input_tokens > 0) {
        setUsageDashboard(dash);
      }
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

  const handleImportFilePaths = async (paths: string[]) => {
    try {
      const imported = await invoke<AttachmentItem[]>("import_local_files_by_path", { paths });
      setAttachments(prev => [...prev, ...imported]);
    } catch (err) {
      console.error("导入文件失败:", err);
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

    // 获取当前主力服务商
    const activeProv = providers.find(p => p.models.includes(activeModel)) || providers[0];
    if (!activeProv.api_key && activeProv.id !== "ollama") {
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

    // 获取主模型组的 Fallback 回退队列！
    const primaryGroup = modelGroupsState.groups.find(g => g.name === modelGroupsState.defaults.default_primary_group) || modelGroupsState.groups[0];
    const fallbackList = primaryGroup ? primaryGroup.fallback_models : [];

    const agentCfg: AgentConfig = {
      provider_id: activeProv.id,
      provider_url: activeProv.provider_url,
      api_key: activeProv.api_key,
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
                  onClick={() => { setShowTopMenu(false); invoke("open_sandbox_dir"); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left"
                >
                  <Globe className="w-4 h-4 text-[#8E8E93]" />
                  <span>打开浏览器</span>
                </button>
                <button
                  onClick={() => { setShowTopMenu(false); setSettingsView("root"); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left border-t border-[#E5E5EA] dark:border-[#2C2C2E]"
                >
                  <SettingsIcon className="w-4 h-4 text-[#8E8E93]" />
                  <span>浏览器设置</span>
                </button>
              </div>
            )}

            {/* 会话时间分组与列表项 (马卡龙柔和图标徽章) */}
            <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-[#E5E5EA] dark:divide-[#1C1C1E]">
              <div className="px-4 py-2 text-[13px] font-bold text-[#8E8E93]">今天</div>
              
              {sessions.map((s, idx) => {
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
                    {/* 马卡龙圆形柔和徽章 */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${colorConfig.bg} ${colorConfig.text}`}>
                      <Sparkle className="w-5 h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-semibold text-sm text-[#1C1C1E] dark:text-[#FFFFFF] truncate">
                          {s.title}
                        </span>
                        <span className="text-[11px] text-[#8E8E93] shrink-0 font-normal">10 小时前</span>
                      </div>
                      <div className="text-xs text-[#8E8E93] truncate">
                        {s.preview || "暂无最新消息摘要"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 右下角悬浮搜索与新建浮钮 */}
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
          2. 主聊天区 (1:1 原版排版 + 原生胶囊输入框 + 思考模式)
      ========================================================================= */}
      <main className="flex-1 flex flex-col h-full bg-[#F2F2F7] dark:bg-[#000000] relative">
        {/* 顶部极简导航栏 */}
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

          {/* 顶栏中心：原版 Minis 模型与思考强度胶囊 */}
          <div className="relative">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-sm text-xs font-medium text-[#1C1C1E] dark:text-[#FFFFFF] transition"
            >
              <span className="truncate max-w-[200px]">{activeModel}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#8E8E93]" />
            </button>

            {showModelPicker && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 w-80 bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-2xl shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                {/* 思考强度分档 */}
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

                {/* 快速切换主服务商与模型 */}
                <div className="text-[11px] font-semibold text-[#8E8E93] mb-1">可用模型池</div>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {providers.flatMap(p => p.models).map(m => (
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
                  ))}
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
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
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

            {/* 思考中与打字中实时流 */}
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

        {/* 悬浮胶囊输入框 (图文混排 + 发送键) */}
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
            {/* 顶栏 */}
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("none")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">设置</h2>
              </div>
            </div>

            {/* 原版 Grouped 大卡片式设置列表 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* LLM 提供商分组 */}
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
                <div className="text-[11px] text-[#8E8E93] px-3 mt-1.5 leading-relaxed">
                  配置 agent 使用的模型,管理每个提供商的 API key 与 OAuth,并创建模型组用于回退或负载均衡。
                </div>
              </div>

              {/* AGENT 运行时分组 */}
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

              {/* 存储分组 */}
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
          4. AI 服务商页面 (1:1 完美复刻截图 1000143326.jpg)
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
                  setProviders(prev => [
                    ...prev,
                    { id: newId, name: "新建供应商", provider_url: "https://api.openai.com/v1", api_key: "", models: [] }
                  ]);
                }}
                className="text-black dark:text-white p-1"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">OPENAI</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  {providers.map(p => (
                    <div key={p.id} className="p-4 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E]/40 transition space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#34C759] shrink-0" />
                          <span className="text-base font-bold text-black dark:text-white">{p.name}</span>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              const list = await invoke<string[]>("fetch_provider_models", { providerUrl: p.provider_url, apiKey: p.api_key });
                              setProviders(prev => prev.map(item => item.id === p.id ? { ...item, models: list } : item));
                            } catch (e) { alert(e); }
                          }}
                          className="text-xs text-[#0A84FF] hover:underline flex items-center gap-1 font-medium"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> 拉取模型
                        </button>
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
                            setProviders(prev => prev.map(item => item.id === p.id ? { ...item, api_key: val } : item));
                          }}
                          placeholder="填入 API Key (sk-...)"
                          className="flex-1 bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-xl px-3 py-1.5 text-xs text-black dark:text-white font-mono focus:outline-none"
                        />
                        <input
                          type="text"
                          value={p.provider_url}
                          onChange={e => {
                            const val = e.target.value;
                            setProviders(prev => prev.map(item => item.id === p.id ? { ...item, provider_url: val } : item));
                          }}
                          className="flex-1 bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-xl px-3 py-1.5 text-xs text-black dark:text-white font-mono focus:outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          5. 模型分组与回退 (1:1 完美复刻截图 1000143328.jpg)
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
              <button className="text-black dark:text-white p-1">
                <Plus className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 分组列表卡片 */}
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">分组</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-2">
                  {modelGroupsState.groups.map(g => (
                    <div key={g.id} className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-base text-black dark:text-white">{g.name}</span>
                          <span className="text-[11px] bg-[#007AFF]/15 text-[#007AFF] px-2 py-0.5 rounded-full font-medium">Primary</span>
                        </div>
                        <div className="text-xs text-[#8E8E93]">回退 · {g.fallback_models.length} models</div>
                        <div className="text-xs text-[#8E8E93] truncate max-w-md">
                          {g.fallback_models.join(", ")}
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-[#8E8E93]" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Defaults 配置卡片 (1:1 复刻截图) */}
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
                      {modelGroupsState.groups.map(g => (
                        <option key={g.id} value={g.name}>{g.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[#8E8E93] mb-1">Default Sub</label>
                    <select className="w-full bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-xl px-3 py-2 text-black dark:text-white font-medium focus:outline-none">
                      <option>无</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[#8E8E93] mb-1">视觉输入</label>
                    <select className="w-full bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-xl px-3 py-2 text-black dark:text-white font-medium focus:outline-none">
                      <option>无</option>
                    </select>
                  </div>

                  <div className="text-[11px] text-[#8E8E93] pt-1 leading-relaxed">
                    主模型用于主要任务，辅助模型用于标题生成等轻量任务。未设置辅助模型时将继承主模型。
                  </div>
                </div>
              </div>

              {/* 智能体循环可用模型 */}
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">智能体循环可用模型</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-3 text-xs">
                  <div className="flex items-center justify-between p-2 rounded-xl bg-[#F2F2F7] dark:bg-[#141416]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-black dark:text-white">AU</span>
                      <span className="text-[10px] bg-[#007AFF]/15 text-[#007AFF] px-1.5 py-0.5 rounded">分组</span>
                      <span className="text-[#8E8E93]">5 个模型</span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button className="flex-1 py-2 rounded-xl bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] text-black dark:text-white font-semibold">
                      + 添加模型
                    </button>
                    <button className="flex-1 py-2 rounded-xl bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] text-black dark:text-white font-semibold">
                      + 添加分组
                    </button>
                  </div>
                  <div className="text-[11px] text-[#8E8E93] leading-relaxed">
                    这里列出的模型和分组可以在终端通过 minis-model-use 调用。只有这些对智能体可见。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          6. Token 用量仪表盘 (1:1 完美复刻截图 1000143344.jpg)
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
              {/* 总用量白底/深灰大卡片 */}
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

              {/* OPENAI 各模型排行榜明细 (1:1 复刻截图) */}
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">OPENAI</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  {usageDashboard.model_rankings.map(item => (
                    <div key={item.model_id} className="flex items-center justify-between p-4 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E]/30 transition">
                      <span className="text-sm font-semibold text-black dark:text-white truncate max-w-[240px]">
                        {item.model_id}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#8E8E93] font-mono">
                          {item.display_input} / {item.display_output}
                        </span>
                        <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          7. MCP 集成界面
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
              <div className="text-xs text-[#8E8E93] px-1 leading-relaxed">
                连接 Model Context Protocol 服务器，工具将直接注册到沙箱调度池供 Agent 调用。
              </div>
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

      {/* =========================================================================
          8. 记忆系统查看
      ========================================================================= */}
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
                {memoryText || "暂无记忆"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
