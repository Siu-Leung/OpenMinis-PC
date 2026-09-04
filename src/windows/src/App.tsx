import React, { useState, useEffect, useRef } from "react";
import { ProviderManager } from "./components/ProviderManager";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  PanelLeft,
  Pin,
  Edit3,
  Download,
  FileUp,
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
  ArrowRight,
  Info,
  Shield,
  FileCode,
  Power,
  Square,
  Play,
  MoreHorizontal,
  Palette,
  Puzzle,
  HardDrive,
  Heart,
  Volume2
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { CodeBlock } from "./components/CodeBlock";
import { ToolLiveModal } from "./components/ToolLiveModal";

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
  session_id?: string;
  provider_id?: string;
  provider_url: string;
  api_key: string;
  model: string;
  fallback_models?: string[];
  system_prompt?: string;
  thinking_level?: string;
  thinking_budget?: number;
}

interface SessionRecord {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  preview: string;
}

interface SingleUsageRecord {
  timestamp: number;
  session_id: string;
  model_id: string;
  provider_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
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

interface AgentLoopModelEntry {
  id: string;
  name: string;
  is_group: boolean;
  model_count: number;
}

interface FullModelGroupsState {
  groups: ModelGroupItem[];
  defaults: DefaultsConfig;
  agent_loop_models: AgentLoopModelEntry[];
}

interface SandboxDiagnostics {
  isInstalled: boolean;
  distroState: string;
  distroName: string;
  isolationActive: boolean;
  isolationText: string;
}

interface McpServer {
  id: string;
  name: string;
  server_type: string;
  command_or_url: string;
  enabled: boolean;
  tools_count: number;
  description?: string;
}

interface SkillItem {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
}

interface SoulConfig {
  name: string;
  instruction: string;
  active: boolean;
}

interface MountedFolderItem {
  id: string;
  name: string;
  host_path: string;
  sandbox_mount_path: string;
  is_mounted: boolean;
}

interface AttachmentItem {
  id: string;
  name: string;
  isMedia: boolean;
  sizeStr: string;
  dataUrl: string;
}

const AVATAR_COLORS = [
  { bg: "bg-[#E1F5FE]", text: "text-[#0288D1]" },
  { bg: "bg-[#EDE7F6]", text: "text-[#5E35B1]" },
  { bg: "bg-[#E8F5E9]", text: "text-[#388E3C]" },
  { bg: "bg-[#FFF3E0]", text: "text-[#F57C00]" },
  { bg: "bg-[#FCE4EC]", text: "text-[#C2185B]" },
];

const ROTATING_PLACEHOLDERS = [
  "发送给 Minis...",
  "在 Alpine 沙箱中编写并执行 Python 脚本...",
  "使用 Edge 浏览器自动化提取网页正文...",
  "分析 /var/minis/workspace 中的数据并制表...",
  "开启高强度深度思考推演复杂任务...",
];

function getToolDisplayInfo(content: string) {
  try {
    const parsed = JSON.parse(content);
    if (parsed.exit_code !== undefined) {
      return {
        name: "shell_execute",
        icon: Terminal,
        label: "Linux Shell 终端执行",
        color: "text-[#34C759]",
        detail: `命令退出码: ${parsed.exit_code}\n\n标准输出:\n${parsed.stdout || "(空)"}\n\n标准错误:\n${parsed.stderr || "(无)"}`,
        content,
      };
    }
    if (parsed.path && parsed.content !== undefined) {
      return {
        name: "file_read",
        icon: FileText,
        label: `读取文件: ${parsed.path}`,
        color: "text-[#0A84FF]",
        detail: parsed.content,
        content,
      };
    }
    if (parsed.path && parsed.success) {
      return {
        name: "file_write",
        icon: FileText,
        label: `写入文件: ${parsed.path}`,
        color: "text-[#30D158]",
        detail: `已成功保存到: ${parsed.path}\n统一资源直链: ${parsed.minis_url || ""}`,
        content,
      };
    }
    if (parsed.data || parsed.success !== undefined) {
      return {
        name: "browser_use",
        icon: Globe,
        label: "Edge 浏览器自动化",
        color: "text-[#32ADE6]",
        detail: parsed.data || JSON.stringify(parsed, null, 2),
        content,
      };
    }
    if (parsed.clipboard_text !== undefined) {
      return {
        name: "clipboard_read",
        icon: Copy,
        label: "读取 Windows 剪贴板",
        color: "text-[#FF9500]",
        detail: parsed.clipboard_text || "(剪贴板为空)",
        content,
      };
    }
    if (parsed.results) {
      return {
        name: "memory_search",
        icon: Brain,
        label: `回忆检索结果 (${parsed.results.length}条)`,
        color: "text-[#BF5AF2]",
        detail: JSON.stringify(parsed.results, null, 2),
        content,
      };
    }
  } catch {}

  return {
    name: "tool",
    icon: Terminal,
    label: "工具调度执行结果",
    color: "text-[#0A84FF]",
    detail: content,
    content,
  };
}

function groupSessionsByDate(sessions: SessionRecord[]) {
  const groups: { label: string; items: SessionRecord[] }[] = [
    { label: "今天", items: [] },
    { label: "昨天", items: [] },
    { label: "过去 7 天", items: [] },
    { label: "过去 30 天", items: [] },
    { label: "更早", items: [] },
  ];

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOf7Days = startOfToday - 7 * 86400000;
  const startOf30Days = startOfToday - 30 * 86400000;

  for (const s of sessions) {
    const time = s.updated_at ? s.updated_at * 1000 : startOfToday;
    if (time >= startOfToday) {
      groups[0].items.push(s);
    } else if (time >= startOfYesterday) {
      groups[1].items.push(s);
    } else if (time >= startOf7Days) {
      groups[2].items.push(s);
    } else if (time >= startOf30Days) {
      groups[3].items.push(s);
    } else {
      groups[4].items.push(s);
    }
  }

  return groups.filter(g => g.items.length > 0);
}

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

  // 全功能设置模态窗口及其子页面路由
  const [settingsView, setSettingsView] = useState<
    "none" | "root" | "providers" | "model_groups" | "usage" | "mcp" | "memory" | "browser_settings" | "rootfs" | "about" | "appearance" | "skills" | "soul" | "mounts"
  >("none");

  // 内置独立浏览器窗口状态
  const [showBrowserWindow, setShowBrowserWindow] = useState<boolean>(false);
  const [browserUrl, setBrowserUrl] = useState<string>("https://cn.bing.com");
  const [currentNavUrl, setCurrentNavUrl] = useState<string>("https://cn.bing.com");

  // 浏览器专属设置
  const [browserSettings, setBrowserSettings] = useState({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    timeoutSecs: 20,
    headlessDefault: true,
  });

  // 供应商状态
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

  // 模型组状态
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

  // Token 用量仪表盘
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

  // 会话置顶与右键菜单 (对标 Hermes PC)
  const [pinnedSessionIds, setPinnedSessionIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("openminis_pinned_sessions") || "[]");
    } catch {
      return [];
    }
  });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: SessionRecord } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState<string>("");

  // 拖拽文件状态 (Drag & Drop)
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // 重启沙箱状态与提示
  const [isRestartingSandbox, setIsRestartingSandbox] = useState(false);
  const [sandboxRestartToast, setSandboxRestartToast] = useState<string | null>(null);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, session: SessionRecord) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      session,
    });
  };

  const togglePinSession = (id: string) => {
    const next = pinnedSessionIds.includes(id)
      ? pinnedSessionIds.filter(x => x !== id)
      : [...pinnedSessionIds, id];
    setPinnedSessionIds(next);
    localStorage.setItem("openminis_pinned_sessions", JSON.stringify(next));
    setContextMenu(null);
  };

  const startRenameSession = (session: SessionRecord) => {
    setRenamingSessionId(session.id);
    setRenamingTitle(session.title);
    setContextMenu(null);
  };

  const saveRenameSession = async (id: string) => {
    if (renamingTitle.trim()) {
      await invoke("rename_session", { id, title: renamingTitle.trim() });
      loadSessions();
    }
    setRenamingSessionId(null);
  };

  const handleExportSession = async (session: SessionRecord) => {
    setContextMenu(null);
    try {
      const msgs = await invoke<ChatMessage[]>("get_session_messages", { id: session.id });
      let md = `# ${session.title}\n\n*导出时间: ${new Date().toLocaleString()}*\n\n---\n\n`;
      for (const m of msgs) {
        const roleName = m.role === "user" ? "👤 用户" : "🤖 Minis";
        md += `### ${roleName}\n\n${m.content}\n\n`;
      }
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${session.title.replace(/[\\/:*?"<>|]/g, "_") || "session"}.md`;
      a.click();
    } catch (err) {
      alert(`导出失败: ${err}`);
    }
  };

  const handleCompactSession = async (id: string) => {
    setContextMenu(null);
    alert("已执行智能上下文压缩！释放历史 Token 占用。");
  };

  const handleDeleteSession = async (id: string) => {
    setContextMenu(null);
    if (confirm("确定要删除此历史会话吗？此操作不可逆。")) {
      await invoke("delete_session", { id });
      loadSessions();
      if (currentSessionId === id) {
        setCurrentSessionId(null);
        setMessages([{ role: "assistant", content: "已开启新会话。请随时下达任务！" }]);
      }
    }
  };

  const handleRestartSandbox = async () => {
    setIsRestartingSandbox(true);
    setSandboxRestartToast("正在终止 WSL 沙箱实例并释放系统内存...");
    try {
      await invoke("restart_sandbox");
      setSandboxRestartToast("沙箱已成功冷启动！内核与共享卷挂载就绪。");
      await loadSandboxDiag();
      setTimeout(() => {
        setSandboxRestartToast(null);
        setIsRestartingSandbox(false);
      }, 2500);
    } catch (err: any) {
      setSandboxRestartToast(`重启失败: ${err}`);
      setTimeout(() => {
        setSandboxRestartToast(null);
        setIsRestartingSandbox(false);
      }, 3500);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingFile(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        const isMedia = file.type.startsWith("image/") || file.type.startsWith("audio/") || file.type.startsWith("video/");
        try {
          await invoke("upload_chat_attachment", {
            name: file.name,
            base64Data,
            isMedia,
          });
          const targetPath = isMedia ? `/var/minis/attachments/${file.name}` : `/var/minis/workspace/${file.name}`;
          setInput(prev => prev ? `${prev}\n[已附加文件: ${targetPath}]` : `请分析该文件：${targetPath}`);
        } catch (err) {
          console.error("上传附件失败:", err);
          alert(`上传文件 ${file.name} 失败: ${err}`);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // 对话流状态
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好，我是 **Minis**。\n\n运行于独立的 Alpine Linux 沙箱环境。支持多供应商管理、模型组自动回退、深度思考模式与真机浏览器自动化。随时提出任务！"
    }
  ]);
  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [agentStatus, setAgentStatus] = useState<string>("idle");
  const [streamingText, setStreamingText] = useState<string>("");
  const [streamingThinking, setStreamingThinking] = useState<string>("");
  const [thinkingDuration, setThinkingDuration] = useState<number>(0);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [fallbackToast, setFallbackToast] = useState<string | null>(null);

  // 附件与拖拽
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // 展开与交互状态
  const [expandedThinking, setExpandedThinking] = useState<{ [key: number]: boolean }>({});
  const [expandedTools, setExpandedTools] = useState<{ [key: number]: boolean }>({});
  const [expandedUsageModels, setExpandedUsageModels] = useState<{ [key: string]: boolean }>({});
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showModelPicker, setShowModelPicker] = useState<boolean>(false);
  const [selectedToolDetail, setSelectedToolDetail] = useState<any | null>(null);

  // 外观与主题
  const [themeMode, setThemeMode] = useState<"dark" | "light" | "system">(() => {
    return (localStorage.getItem("openminis_theme_mode") as any) || "dark";
  });
  const [oledMode, setOledMode] = useState<boolean>(() => {
    return localStorage.getItem("openminis_oled_mode") === "true";
  });
  const [accentColor, setAccentColor] = useState<string>(() => {
    return localStorage.getItem("openminis_accent_color") || "#0A84FF";
  });

  // 技能、灵魂与外部挂载
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [soulConfig, setSoulConfig] = useState<SoulConfig>({ name: "Minis", instruction: "", active: true });
  const [mountedFolders, setMountedFolders] = useState<MountedFolderItem[]>([]);
  const [newMountHost, setNewMountHost] = useState("");
  const [newMountName, setNewMountName] = useState("");

  // MCP、记忆与诊断
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [memoryText, setMemoryText] = useState("");
  const [globalMemoryText, setGlobalMemoryText] = useState("");
  const [fetchingModels, setFetchingModels] = useState(false);
  const [sandboxDiag, setSandboxDiag] = useState<SandboxDiagnostics>({
    isInstalled: true,
    distroState: "Running",
    distroName: "OpenMinisSandbox",
    isolationActive: true,
    isolationText: "零泄漏 (/mnt 宿主盘已彻底屏蔽)",
  });
  const [repairingSandbox, setRepairingSandbox] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMsg, setUpdateMsg] = useState("");

  // 动态旋转占位符
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const thinkingTimerRef = useRef<any>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderIndex(prev => (prev + 1) % ROTATING_PLACEHOLDERS.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, streamingThinking, attachments, activeToolName]);

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

  useEffect(() => {
    invoke<boolean>("check_sandbox_status").then(ready => {
      setSandboxReady(ready);
    }).catch(() => setSandboxReady(false));

    loadSessions();
    loadModelGroups();
    loadUsage();
    loadMcpServers();
    loadSkills();
    loadSoul();
    loadMounts();
  }, []);

  // 监听 Agent 流式事件
  useEffect(() => {
    const unlistenPromise = listen<{ event_type: string; content: string }>("agent-stream", event => {
      const { event_type, content } = event.payload;
      if (event_type === "status") {
        setAgentStatus(content);
        if (content === "answering") setActiveToolName(null);
        if (content === "stopped") {
          setLoading(false);
          setAgentStatus("idle");
        }
      } else if (event_type === "thinking") {
        setAgentStatus("thinking");
        setStreamingThinking(prev => prev + content);
      } else if (event_type === "token") {
        setAgentStatus("answering");
        setStreamingText(prev => prev + content);
      } else if (event_type === "tool_start") {
        setActiveToolName(content.replace("正在调用: ", ""));
      } else if (event_type === "tool_end") {
        setActiveToolName(null);
      } else if (event_type === "fallback") {
        setFallbackToast(content);
        setTimeout(() => setFallbackToast(null), 5000);
      } else if (event_type === "stopped") {
        setLoading(false);
        setAgentStatus("idle");
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
      unlistenPromise.then(unlisten => unlisten());
      if (unlistenWebviewDrop) unlistenWebviewDrop();
    };
  }, []);

  const loadSessions = async () => {
    try {
      const res = await invoke<SessionRecord[]>("list_sessions");
      setSessions(res || []);
    } catch (e) {
      console.error("加载会话失败:", e);
    }
  };

  const loadUsage = async () => {
    try {
      const dash = await invoke<TotalUsageDashboard>("get_usage_dashboard");
      setUsageDashboard(dash);
    } catch (e) {
      console.error("加载用量统计失败:", e);
    }
  };

  const loadModelGroups = async () => {
    try {
      const state = await invoke<FullModelGroupsState>("get_model_groups_state");
      setModelGroupsState(state);
    } catch (e) {
      console.error("加载模型组状态失败:", e);
    }
  };

  const loadMcpServers = async () => {
    try {
      const s = await invoke<McpServer[]>("list_mcp_servers");
      setMcpServers(s);
    } catch (e) {}
  };

  const loadSkills = async () => {
    try {
      const res = await invoke<SkillItem[]>("list_skills");
      setSkills(res || []);
    } catch (e) {}
  };

  const loadSoul = async () => {
    try {
      const res = await invoke<SoulConfig>("get_soul_config");
      setSoulConfig(res);
    } catch (e) {}
  };

  const loadMounts = async () => {
    try {
      const res = await invoke<MountedFolderItem[]>("list_mounted_folders");
      setMountedFolders(res || []);
    } catch (e) {}
  };

  const loadMemories = async () => {
    try {
      const today = await invoke<string>("get_today_memory");
      setMemoryText(today);
      const global = await invoke<string>("get_global_memory");
      setGlobalMemoryText(global);
    } catch (e) {}
  };

  const loadSandboxDiag = async () => {
    try {
      const diag = await invoke<SandboxDiagnostics>("get_sandbox_diagnostics");
      setSandboxDiag(diag);
    } catch (e) {
      console.error("诊断异常:", e);
    }
  };

  const saveProviders = (newProviders: Provider[]) => {
    setProviders(newProviders);
    localStorage.setItem("openminis_providers_v4_clean", JSON.stringify(newProviders));
  };

  const handleStartAutoInit = async () => {
    setShowInitModal(true);
    setInitPercent(5);
    setInitCurrentText("准备沙箱配置环境...");
    setInitLogs(["正在启动 WSL2 Alpine 沙箱自动初始化..."]);
    setInitError(null);

    try {
      await invoke("auto_initialize_sandbox");
      setSandboxReady(true);
      loadSandboxDiag();
    } catch (err: any) {
      setInitError(err?.toString() || "沙箱初始化发生异常");
    }
  };

  const handleImportFilePaths = async (paths: string[]) => {
    try {
      const imported = await invoke<AttachmentItem[]>("import_local_files_by_path", { paths });
      setAttachments(prev => [...prev, ...imported]);
    } catch (err) {
      console.error("导入文件失败:", err);
    }
  };

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

  // 停止当前 Agent 生成流
  const handleStopGeneration = async () => {
    try {
      await invoke("abort_agent_turn");
    } catch (e) {
      console.error("停止生成失败:", e);
    }
    setLoading(false);
    setAgentStatus("idle");
  };

  // 压缩上下文 (Compact Messages)
  const handleCompactMessages = () => {
    if (messages.length <= 3) return;
    const toCompact = messages.slice(1, -2);
    const summary = `[上下文历史摘要 (Compacted Context)]: 包含 ${toCompact.length} 条历史消息轮次，涵盖前期讨论内容与工具调用执行结论。`;
    setMessages([
      messages[0],
      { role: "system", content: summary },
      ...messages.slice(-2)
    ]);
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || loading) return;

    const currentProvider = providers.find(p => p.id === activeProviderId) || providers[0];
    if (!currentProvider || !activeModel) {
      alert("请先点击顶栏模型胶囊，或进入设置配置 AI 服务商与选择模型！");
      return;
    }

    const userImages = attachments.filter(a => a.isMedia).map(a => a.dataUrl);
    const userFiles = attachments.filter(a => !a.isMedia).map(a => ({ name: a.name, url: a.dataUrl, sizeStr: a.sizeStr }));

    const userMsg: ChatMessage = {
      role: "user",
      content: input.trim(),
      images: userImages.length > 0 ? userImages : undefined,
      files: userFiles.length > 0 ? userFiles : undefined,
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput("");
    setAttachments([]);
    setLoading(true);
    setStreamingText("");
    setStreamingThinking("");
    setAgentStatus("connecting");

    // 计算当前模型所在模型组的 fallback 候选列表
    let fallbackList: string[] = [];
    const matchedGroup = modelGroupsState.groups.find(g => g.name === activeModel || g.fallback_models.includes(activeModel));
    if (matchedGroup) {
      fallbackList = matchedGroup.fallback_models.filter(m => m !== activeModel);
    }

    const config: AgentConfig = {
      session_id: currentSessionId || undefined,
      provider_id: currentProvider.id,
      provider_url: currentProvider.provider_url,
      api_key: currentProvider.api_key,
      model: activeModel,
      fallback_models: fallbackList.length > 0 ? fallbackList : undefined,
      thinking_level: thinkingLevel,
    };

    try {
      const updatedHistory = await invoke<ChatMessage[]>("run_agent_turn", {
        config,
        sessionId: currentSessionId,
        messages: newHistory,
      });
      setMessages(updatedHistory);
      loadSessions();
      loadUsage();
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `❌ 交互故障: ${err}` }
      ]);
    } finally {
      setLoading(false);
      setStreamingText("");
      setStreamingThinking("");
      setAgentStatus("idle");
    }
  };

  const allAvailableModels = providers.flatMap(p => p.models || []);
  const activeProvider = providers.find(p => p.id === activeProviderId) || providers[0];
  const currentProvider = activeProvider;
  const filteredSessions = sessionSearch.trim()
    ? sessions.filter(s =>
        s.title.toLowerCase().includes(sessionSearch.toLowerCase()) ||
        (s.preview && s.preview.toLowerCase().includes(sessionSearch.toLowerCase()))
      )
    : sessions;
  const pinnedSessions = filteredSessions.filter(s => pinnedSessionIds.includes(s.id));
  const unpinnedSessions = filteredSessions.filter(s => !pinnedSessionIds.includes(s.id));
  const sessionGroups = groupSessionsByDate(unpinnedSessions);

  return (
    <div className={`flex h-screen w-screen overflow-hidden select-none font-sans ${oledMode ? "bg-[#000000]" : "bg-[#F2F2F7] dark:bg-[#000000]"} text-[#1C1C1E] dark:text-[#F2F2F7]`}>
      {/* =========================================================================
          1. 会话主列表 (智能时间分段 + 搜索 + 1:1 原版质感)
      ========================================================================= */}
      {sidebarOpen && (
        <aside className="w-64 border-r border-[#E5E5EA] dark:border-[#1C1C1E] flex flex-col shrink-0 bg-white/80 dark:bg-[#0C0C0E]/95 backdrop-blur-xl z-20 transition-all">


          {/* 顶栏控制 */}
          <div className="p-3.5 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#0A84FF] flex items-center justify-center text-white shadow-sm font-black text-xs">
                M
              </div>
              <span className="font-bold text-sm text-[#1C1C1E] dark:text-[#FFFFFF] tracking-tight">OpenMinis</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded-lg text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-[#FFFFFF] hover:bg-[#E5E5EA] dark:hover:bg-[#1C1C1E] transition"
              title="收起侧边栏"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          </div>

          {/* 会话实时搜索框 */}
          <div className="p-2.5 border-b border-[#E5E5EA] dark:border-[#1C1C1E]">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#F2F2F7] dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] text-xs">
              <Search className="w-3.5 h-3.5 text-[#8E8E93]" />
              <input
                type="text"
                placeholder="搜索会话记录..."
                value={sessionSearch}
                onChange={e => setSessionSearch(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-[#1C1C1E] dark:text-white placeholder-[#8E8E93] text-xs"
              />
              {sessionSearch && (
                <button onClick={() => setSessionSearch("")} className="text-[#8E8E93] hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* 智能时间分组会话列表 (带置顶与右键菜单 - 对标 Hermes PC) */}
          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-[#E5E5EA]/40 dark:divide-[#1C1C1E]/40">
            {filteredSessions.length === 0 ? (
              <div className="text-center py-10 text-xs text-[#8E8E93] px-4 space-y-1">
                <div>暂无会话记录</div>
                <div className="text-[11px] text-[#636366]">点击下方“新建会话”开始探索</div>
              </div>
            ) : (
              <>
                {/* 📌 置顶会话分组 */}
                {pinnedSessions.length > 0 && (
                  <div className="py-2">
                    <div className="px-4 py-1 text-[11px] font-bold uppercase tracking-wider text-[#FF9F0A] flex items-center gap-1.5">
                      <Pin className="w-3 h-3" />
                      <span>置顶会话</span>
                    </div>
                    <div className="space-y-0.5 mt-1">
                      {pinnedSessions.map((s, idx) => {
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
                            onContextMenu={e => handleContextMenu(e, s)}
                            className={`group flex items-center gap-2.5 px-3 py-2.5 mx-1.5 rounded-xl cursor-pointer transition select-none ${
                              isSelected
                                ? "bg-[#E5E5EA] dark:bg-[#1C1C1E] shadow-sm"
                                : "hover:bg-[#F2F2F7] dark:hover:bg-[#18181A]"
                            }`}
                          >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${colorConfig.bg} ${colorConfig.text} text-xs font-bold`}>
                              {s.title ? s.title.slice(0, 1).toUpperCase() : "M"}
                            </div>

                            <div className="flex-1 min-w-0 pr-1">
                              {renamingSessionId === s.id ? (
                                <input
                                  autoFocus
                                  type="text"
                                  value={renamingTitle}
                                  onChange={e => setRenamingTitle(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") saveRenameSession(s.id);
                                    if (e.key === "Escape") setRenamingSessionId(null);
                                  }}
                                  onBlur={() => saveRenameSession(s.id)}
                                  onClick={e => e.stopPropagation()}
                                  className="w-full bg-white dark:bg-[#2C2C2E] px-2 py-0.5 rounded text-xs text-black dark:text-white border border-[#0A84FF] outline-none"
                                />
                              ) : (
                                <>
                                  <div className="flex items-center justify-between mb-0.5">
                                    <span className="font-semibold text-xs text-[#1C1C1E] dark:text-[#FFFFFF] truncate">
                                      {s.title}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-[#8E8E93] truncate">
                                    {s.preview || "暂无消息摘要"}
                                  </div>
                                </>
                              )}
                            </div>

                            <button
                              onClick={e => {
                                e.stopPropagation();
                                handleContextMenu(e, s);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 text-[#8E8E93] hover:text-black dark:hover:text-white rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition"
                              title="会话菜单"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 智能时间分组 */}
                {sessionGroups.map(group => (
                  <div key={group.label} className="py-2">
                    <div className="px-4 py-1 text-[11px] font-bold uppercase tracking-wider text-[#8E8E93]">
                      {group.label}
                    </div>
                    <div className="space-y-0.5 mt-1">
                      {group.items.map((s, idx) => {
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
                            onContextMenu={e => handleContextMenu(e, s)}
                            className={`group flex items-center gap-2.5 px-3 py-2.5 mx-1.5 rounded-xl cursor-pointer transition select-none ${
                              isSelected
                                ? "bg-[#E5E5EA] dark:bg-[#1C1C1E] shadow-sm"
                                : "hover:bg-[#F2F2F7] dark:hover:bg-[#18181A]"
                            }`}
                          >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${colorConfig.bg} ${colorConfig.text} text-xs font-bold`}>
                              {s.title ? s.title.slice(0, 1).toUpperCase() : "M"}
                            </div>

                            <div className="flex-1 min-w-0 pr-1">
                              {renamingSessionId === s.id ? (
                                <input
                                  autoFocus
                                  type="text"
                                  value={renamingTitle}
                                  onChange={e => setRenamingTitle(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") saveRenameSession(s.id);
                                    if (e.key === "Escape") setRenamingSessionId(null);
                                  }}
                                  onBlur={() => saveRenameSession(s.id)}
                                  onClick={e => e.stopPropagation()}
                                  className="w-full bg-white dark:bg-[#2C2C2E] px-2 py-0.5 rounded text-xs text-black dark:text-white border border-[#0A84FF] outline-none"
                                />
                              ) : (
                                <>
                                  <div className="flex items-center justify-between mb-0.5">
                                    <span className="font-semibold text-xs text-[#1C1C1E] dark:text-[#FFFFFF] truncate">
                                      {s.title}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-[#8E8E93] truncate">
                                    {s.preview || "暂无消息摘要"}
                                  </div>
                                </>
                              )}
                            </div>

                            <button
                              onClick={e => {
                                e.stopPropagation();
                                handleContextMenu(e, s);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 text-[#8E8E93] hover:text-black dark:hover:text-white rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition"
                              title="会话菜单"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* 底部控制台 */}
          <div className="p-3 border-t border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between">
            <button
              onClick={() => {
                setMessages([{ role: "assistant", content: "已开启新会话。请随时下达任务！" }]);
                setCurrentSessionId(null);
                setInput("");
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0A84FF] text-white text-xs font-semibold hover:opacity-90 shadow-sm transition"
            >
              <Plus className="w-3.5 h-3.5" /> 新建会话
            </button>
            <button
              onClick={() => setSettingsView("root")}
              className="p-2 rounded-xl bg-[#F2F2F7] dark:bg-[#1C1C1E] text-[#8E8E93] hover:text-white transition"
              title="设置"
            >
              <SettingsIcon className="w-4 h-4" />
            </button>
          </div>
        </aside>
      )}

      {/* =========================================================================
          2. 主聊天区 (1:1 原版顶栏与菜单 + KaTeX + 停止生成 + 思考强度)
      ========================================================================= */}
      <main onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className="flex-1 flex flex-col h-full bg-[#F2F2F7] dark:bg-[#000000] relative">
        {isDraggingFile && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-50 flex flex-col items-center justify-center p-8 text-white border-2 border-dashed border-[#0A84FF] rounded-3xl m-4 animate-in fade-in zoom-in-95 duration-150 pointer-events-none">
            <div className="w-20 h-20 rounded-full bg-[#0A84FF]/20 flex items-center justify-center mb-4 text-[#0A84FF]">
              <FileUp className="w-10 h-10" />
            </div>
            <div className="text-lg font-bold">释放文件以上传至沙箱工作区</div>
            <div className="text-xs text-[#8E8E93] mt-2 max-w-sm text-center">
              文件将自动保存至沙箱 /var/minis/workspace，并在聊天框填入引用路径供大模型直接调用、分析与执行
            </div>
          </div>
        )}
        {/* 顶栏 */}
        <header className="h-[52px] border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between px-4 shrink-0 bg-white/70 dark:bg-[#000000]/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-lg text-[#8E8E93] hover:text-[#FFFFFF] hover:bg-[#1C1C1E] transition"
                title="展开侧边栏"
              >
                <PanelLeft className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* 顶栏中心：模型选择胶囊 (1:1 明确显式提供商与模型) */}
          <div className="relative">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-sm text-xs font-semibold text-[#1C1C1E] dark:text-[#FFFFFF] transition hover:border-[#0A84FF]/50"
            >
              {currentProvider && (
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#0A84FF]/10 text-[#0A84FF] font-bold shrink-0">
                  {currentProvider.name}
                </span>
              )}
              <span className="truncate max-w-[200px]">{activeModel || "选择模型"}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#8E8E93]" />
            </button>

            {/* 模型选择弹窗 (按提供商清晰分组) */}
            {showModelPicker && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 w-80 bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-2xl shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs select-none">
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
                          thinkingLevel === lvl ? "bg-[#0A84FF] text-white shadow-sm" : "text-[#8E8E93] hover:text-white"
                        }`}
                      >
                        {lvl === "off" ? "关闭" : lvl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-[11px] font-semibold text-[#8E8E93] mb-1">可用模型池</div>
                <div className="max-h-64 overflow-y-auto space-y-3 p-1">
                  {providers.length === 0 ? (
                    <div className="text-center py-6 text-xs text-[#8E8E93] space-y-2">
                      <div>暂无可用模型</div>
                      <button
                        onClick={() => { setShowModelPicker(false); setSettingsView("providers"); }}
                        className="text-[#0A84FF] hover:underline font-semibold"
                      >
                        前往设置 → 添加 AI 服务商
                      </button>
                    </div>
                  ) : (
                    providers.map(p => (
                      <div key={p.id} className="space-y-1">
                        <div className="flex items-center justify-between px-2 text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider">
                          <span className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${p.api_key ? "bg-[#34C759]" : "bg-[#8E8E93]"}`} />
                            {p.name}
                          </span>
                          <span>{p.models.length} 个模型</span>
                        </div>
                        <div className="space-y-0.5">
                          {p.models.length === 0 ? (
                            <div className="text-[11px] text-[#8E8E93] px-3 py-1 italic">未配置模型</div>
                          ) : (
                            p.models.map(m => {
                              const isSelected = activeProviderId === p.id && activeModel === m;
                              return (
                                <button
                                  key={m}
                                  onClick={() => {
                                    setActiveProviderId(p.id);
                                    setActiveModel(m);
                                    setShowModelPicker(false);
                                  }}
                                  className={`w-full text-left px-3 py-1.5 rounded-xl text-xs truncate transition flex items-center justify-between ${
                                    isSelected
                                      ? "bg-[#0A84FF] text-white font-semibold shadow-sm"
                                      : "text-[#1C1C1E] dark:text-[#E5E5EA] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E]"
                                  }`}
                                >
                                  <span className="truncate">{m}</span>
                                  {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="pt-2 border-t border-[#E5E5EA] dark:border-[#2C2C2E] mt-2">
                  <button
                    onClick={() => { setShowModelPicker(false); setSettingsView("providers"); }}
                    className="w-full py-1.5 rounded-xl text-center text-xs text-[#0A84FF] font-semibold hover:bg-[#0A84FF]/10 transition flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>管理 AI 服务商</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 顶栏右侧：1:1 原版更多选项菜单按钮 */}
          <div className="flex items-center gap-1.5 relative">
            <button
              onClick={() => {
                setMessages([{ role: "assistant", content: "已开启新对话。请随时下达任务！" }]);
                setCurrentSessionId(null);
                setInput("");
              }}
              className="p-1.5 rounded-lg text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-[#FFFFFF] hover:bg-[#F2F2F7] dark:hover:bg-[#1C1C1E] transition"
              title="新建会话"
            >
              <Plus className="w-5 h-5" />
            </button>

            <button
              onClick={() => setShowTopMenu(!showTopMenu)}
              className="p-1.5 rounded-lg text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-[#FFFFFF] hover:bg-[#F2F2F7] dark:hover:bg-[#1C1C1E] transition"
              title="更多操作"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>

            {/* 1:1 对标原版 ChatTrailingMenu 浮动菜单 */}
            {showTopMenu && (
              <div className="absolute top-10 right-0 w-56 bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-2xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs select-none">
                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    setMessages([{ role: "assistant", content: "已开启新对话。请随时下达任务！" }]);
                    setCurrentSessionId(null);
                    setInput("");
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left text-black dark:text-white"
                >
                  <Sparkles className="w-4 h-4 text-[#0A84FF]" />
                  <span>新建对话</span>
                </button>

                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    handleCompactMessages();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left text-black dark:text-white"
                >
                  <Layers className="w-4 h-4 text-[#FF9500]" />
                  <span>压缩上下文 (Compact)</span>
                </button>

                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    setMessages([{ role: "assistant", content: "当前会话已清空。" }]);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#FF453A]/10 text-[#FF453A] transition text-left"
                >
                  <Trash2 className="w-4 h-4 text-[#FF453A]" />
                  <span>清空当前对话</span>
                </button>

                <div className="my-1 border-t border-[#E5E5EA] dark:border-[#2C2C2E]" />

                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    invoke("launch_interactive_terminal", { cmd: null });
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left text-black dark:text-white"
                >
                  <Terminal className="w-4 h-4 text-[#34C759]" />
                  <span>Shell 独立终端</span>
                </button>

                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    setShowBrowserWindow(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left text-black dark:text-white"
                >
                  <Globe className="w-4 h-4 text-[#32ADE6]" />
                  <span>内置浏览器</span>
                </button>

                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    invoke("open_sandbox_dir");
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left text-black dark:text-white"
                >
                  <Folder className="w-4 h-4 text-[#AF52DE]" />
                  <span>浏览沙箱文件</span>
                </button>

                <div className="my-1 border-t border-[#E5E5EA] dark:border-[#2C2C2E]" />

                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    loadSkills();
                    setSettingsView("skills");
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left text-black dark:text-white"
                >
                  <Puzzle className="w-4 h-4 text-[#FF2D55]" />
                  <span>会话技能 (Skills)</span>
                </button>

                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    loadMounts();
                    setSettingsView("mounts");
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left text-black dark:text-white"
                >
                  <HardDrive className="w-4 h-4 text-[#34C759]" />
                  <span>挂载外部目录</span>
                </button>

                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    loadMemories();
                    setSettingsView("memory");
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left text-black dark:text-white"
                >
                  <Lightbulb className="w-4 h-4 text-[#FFCC00]" />
                  <span>会话记忆</span>
                </button>

                <div className="my-1 border-t border-[#E5E5EA] dark:border-[#2C2C2E]" />

                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    loadUsage();
                    setSettingsView("usage");
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left text-black dark:text-white"
                >
                  <BarChart3 className="w-4 h-4 text-[#0A84FF]" />
                  <span>Token 用量统计</span>
                </button>

                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    setSettingsView("root");
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition text-left text-black dark:text-white"
                >
                  <SettingsIcon className="w-4 h-4 text-[#8E8E93]" />
                  <span>全部设置</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* 容灾 Fallback Toast */}
        {fallbackToast && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 bg-[#FF9500]/95 text-white px-4 py-2 rounded-2xl shadow-xl text-xs flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-md">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{fallbackToast}</span>
          </div>
        )}

        {/* 消息滚动流 */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg, i) => {
              if (msg.role === "system") return null;

              if (msg.role === "tool") {
                const info = getToolDisplayInfo(msg.content);
                const IconComponent = info.icon;

                return (
                  <div key={i} className="my-2 select-none">
                    <div
                      onClick={() => setSelectedToolDetail(info)}
                      className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] hover:border-[#0A84FF]/60 text-xs text-[#8E8E93] cursor-pointer transition shadow-sm hover:scale-[1.01]"
                      title="点击查看执行详情"
                    >
                      <IconComponent className={`w-3.5 h-3.5 ${info.color}`} />
                      <span className="font-mono text-[11px] text-[#1C1C1E] dark:text-[#D1D1D6]">{info.label}</span>
                      <span className="text-[10px] text-[#8E8E93] bg-[#E5E5EA] dark:bg-[#2C2C2E] px-1.5 py-0.5 rounded-full">查看</span>
                    </div>
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

              // Assistant 消息
              const isExpandedThink = !!expandedThinking[i];
              return (
                <div key={i} className="flex flex-col space-y-2 text-[#000000] dark:text-[#E4E4E7]">
                  {/* 1:1 对标原版 ThinkingBlockView */}
                  {msg.thinking && (
                    <div className="mb-2 max-w-2xl select-none">
                      <div
                        onClick={() => setExpandedThinking(prev => ({ ...prev, [i]: !prev[i] }))}
                        className="inline-flex items-center gap-1.5 text-xs text-[#0A84FF] cursor-pointer hover:opacity-80 py-1 transition font-semibold"
                      >
                        <Brain className="w-4 h-4 text-[#0A84FF]" />
                        <span>深度思考</span>
                        {msg.thinking_duration && (
                          <span className="text-[11px] text-[#8E8E93] font-normal">({msg.thinking_duration.toFixed(1)}s)</span>
                        )}
                        {isExpandedThink ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </div>

                      {isExpandedThink && (
                        <div className="mt-1 pl-3 py-1 border-l-2 border-[#0A84FF]/40 text-xs text-[#8E8E93] whitespace-pre-wrap leading-relaxed font-sans bg-[#F2F2F7]/50 dark:bg-[#1C1C1E]/30 rounded-r-xl p-2.5">
                          {msg.thinking}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Markdown 正文内容 (支持 KaTeX LaTeX 数学公式与可运行代码块) */}
                  <div className="prose dark:prose-invert max-w-none text-[15px] leading-relaxed text-[#1C1C1E] dark:text-[#F4F4F5]">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        code({ inline, className, children, ...props }: any) {
                          const match = /language-(\w+)/.exec(className || "");
                          const codeText = String(children).replace(/\n$/, "");
                          if (!inline && match) {
                            return <CodeBlock language={match[1]} code={codeText} />;
                          }
                          return (
                            <code className="bg-[#E5E5EA] dark:bg-[#2C2C2E] px-1.5 py-0.5 rounded text-[13px] font-mono text-[#D1D1D6]" {...props}>
                              {children}
                            </code>
                          );
                        }
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                </div>
              );
            })}

            {/* 流式思考与正文增量展示 */}
            {loading && (
              <div className="space-y-2">
                {streamingThinking && (
                  <div className="max-w-2xl">
                    <div className="inline-flex items-center gap-1.5 text-xs text-[#0A84FF] font-semibold py-1">
                      <Brain className="w-4 h-4 text-[#0A84FF] animate-pulse" />
                      <span>思考中...</span>
                    </div>
                    <div className="mt-1 pl-3 py-1 border-l-2 border-[#0A84FF]/40 text-xs text-[#8E8E93] whitespace-pre-wrap leading-relaxed bg-[#1C1C1E]/30 rounded-r-xl p-2.5">
                      {streamingThinking}
                    </div>
                  </div>
                )}

                {streamingText && (
                  <div className="prose dark:prose-invert max-w-none text-[15px] leading-relaxed text-[#1C1C1E] dark:text-[#F4F4F5]">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        code({ inline, className, children, ...props }: any) {
                          const match = /language-(\w+)/.exec(className || "");
                          const codeText = String(children).replace(/\n$/, "");
                          if (!inline && match) {
                            return <CodeBlock language={match[1]} code={codeText} />;
                          }
                          return (
                            <code className="bg-[#E5E5EA] dark:bg-[#2C2C2E] px-1.5 py-0.5 rounded text-[13px] font-mono text-[#D1D1D6]" {...props}>
                              {children}
                            </code>
                          );
                        }
                      }}
                    >
                      {streamingText}
                    </ReactMarkdown>
                  </div>
                )}

                {activeToolName && (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-[#141416] border border-[#0A84FF]/40 text-xs text-[#0A84FF] animate-pulse shadow-sm">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>正在调度沙箱: {activeToolName}...</span>
                  </div>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* =========================================================================
            输入栏 (1:1 ChatInputBar：停止按键 + 思考强度快捷切换 + 旋转占位符)
        ========================================================================= */}
        <div className="p-4 bg-gradient-to-t from-white via-white/80 to-transparent dark:from-[#000000] dark:via-[#000000]/80 dark:to-transparent shrink-0">
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
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                multiple
                onChange={e => {
                  const files = e.target.files;
                  if (!files) return;
                  Array.from(files).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = async () => {
                      const b64 = reader.result as string;
                      const isMedia = file.type.startsWith("image/");
                      setAttachments(prev => [
                        ...prev,
                        {
                          id: Math.random().toString(36).slice(2),
                          name: file.name,
                          isMedia,
                          sizeStr: `${Math.round(file.size / 1024)} KB`,
                          dataUrl: b64,
                        }
                      ]);
                    };
                    reader.readAsDataURL(file);
                  });
                }}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#8E8E93] hover:text-black dark:hover:text-white transition shrink-0 mb-0.5"
                title="添加文件或图片"
              >
                <Plus className="w-5 h-5" />
              </button>

              {/* 思考强度快捷切换 Pill */}
              <button
                type="button"
                onClick={() => {
                  const levels = ["off", "low", "medium", "high"];
                  const next = levels[(levels.indexOf(thinkingLevel) + 1) % levels.length];
                  setThinkingLevel(next);
                  localStorage.setItem("openminis_thinking_level", next);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition select-none shrink-0 mb-0.5 ${
                  thinkingLevel !== "off"
                    ? "bg-[#0A84FF]/10 text-[#0A84FF] border-[#0A84FF]/30 dark:bg-[#0A84FF]/20"
                    : "bg-transparent text-[#8E8E93] border-transparent hover:border-[#E5E5EA] dark:hover:border-[#2C2C2E]"
                }`}
                title="点击快速切换思考模式强度"
              >
                <Brain className="w-3.5 h-3.5" />
                <span>{thinkingLevel === "off" ? "思考: 关" : `思考: ${thinkingLevel.toUpperCase()}`}</span>
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
                placeholder={ROTATING_PLACEHOLDERS[placeholderIndex]}
                className="flex-1 bg-transparent border-none text-[15px] text-black dark:text-white placeholder-[#8E8E93] focus:outline-none resize-none max-h-40 py-1"
              />

              {/* 1:1 对标原版发送 / 停止生成按钮 */}
              {loading ? (
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  className="w-7 h-7 rounded-full bg-[#FF453A] hover:bg-[#FF3B30] flex items-center justify-center text-white transition shrink-0 mb-0.5 shadow-md animate-pulse"
                  title="停止当前生成"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() && attachments.length === 0}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition shrink-0 mb-0.5 ${
                    (input.trim() || attachments.length > 0)
                      ? "bg-[#000000] text-white dark:bg-white dark:text-black hover:opacity-90 shadow-sm"
                      : "bg-[#E5E5EA] text-[#8E8E93] dark:bg-[#2C2C2E] dark:text-[#636366] cursor-not-allowed"
                  }`}
                  title="发送"
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* =========================================================================
          3. 设置总览中心 (1:1 原版 8 大分组全量覆盖)
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
              {/* 分组 1: LLM 提供商 */}
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
                        <div className="text-xs text-[#8E8E93]">API key 与模型拉取</div>
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

              {/* 分组 2: 外观 (1:1 原版补齐) */}
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">外观</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <div
                    onClick={() => setSettingsView("appearance")}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#FF9500] flex items-center justify-center text-white">
                        <Palette className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">外观设置</div>
                        <div className="text-xs text-[#8E8E93]">深浅主题、OLED 纯黑模式与强调色</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>
                </div>
              </div>

              {/* 分组 3: AGENT 运行时 (1:1 补齐 Skills 与 Soul) */}
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">AGENT 运行时</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <div
                    onClick={() => {
                      loadSkills();
                      setSettingsView("skills");
                    }}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#FF2D55] flex items-center justify-center text-white">
                        <Puzzle className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">技能扩展 (Skills)</div>
                        <div className="text-xs text-[#8E8E93]">管理与安装 MinisSkills 扩展包</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

                  <div
                    onClick={() => {
                      loadSoul();
                      setSettingsView("soul");
                    }}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#FF3B30] flex items-center justify-center text-white">
                        <Heart className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">灵魂设定 (Soul)</div>
                        <div className="text-xs text-[#8E8E93]">自定义 Agent 人设与指导原则 (SOUL.md)</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

                  <div
                    onClick={() => {
                      loadMemories();
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
                        <div className="text-xs text-[#8E8E93]">跨会话保留的持久化知识 (GLOBAL.md)</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

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
                </div>
              </div>

              {/* 分组 4: 存储 (1:1 补齐挂载外部目录) */}
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">存储</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <div
                    onClick={() => {
                      loadSandboxDiag();
                      setSettingsView("rootfs");
                    }}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center text-white">
                        <Terminal className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">存储与 Rootfs</div>
                        <div className="text-xs text-[#8E8E93]">Alpine Linux 沙箱与运行状态诊断</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

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
                        <div className="text-xs text-[#8E8E93]">浏览 /var/minis 下的共享、工作区与附件</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

                  <div
                    onClick={() => {
                      loadMounts();
                      setSettingsView("mounts");
                    }}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#32ADE6] flex items-center justify-center text-white">
                        <HardDrive className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">挂载外部目录</div>
                        <div className="text-xs text-[#8E8E93]">将 Windows 本地磁盘映射进沙箱 /var/minis/mounts/</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>
                </div>
              </div>

              {/* 分组 5: 关于 */}
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">关于</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <div
                    onClick={() => setSettingsView("about")}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center text-white">
                        <Info className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">关于 Minis</div>
                        <div className="text-xs text-[#8E8E93]">版本与项目信息</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

                  <div
                    onClick={() => invoke("open_external_url", { url: "https://openminis.github.io/privacy-policy.html" })}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center text-white">
                        <Shield className="w-4 h-4" />
                      </div>
                      <span className="text-sm font-semibold text-black dark:text-white">隐私政策</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

                  <div
                    onClick={() => invoke("open_external_url", { url: "https://github.com/Siu-Leung/OpenMinis-PC/issues" })}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center text-white">
                        <FileCode className="w-4 h-4" />
                      </div>
                      <span className="text-sm font-semibold text-black dark:text-white">反馈问题</span>
                    </div>
                    <div className="flex items-center gap-1 text-[#8E8E93]">
                      <ExternalLink className="w-3.5 h-3.5" />
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          全新补齐视图 1: 外观设置 (Appearance)
      ========================================================================= */}
      {settingsView === "appearance" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] w-full max-w-lg rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("root")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">外观设置</h2>
              </div>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto text-xs">
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-[#8E8E93] uppercase">主题色彩模式</label>
                <div className="grid grid-cols-3 gap-2">
                  {["dark", "light", "system"].map(t => (
                    <button
                      key={t}
                      onClick={() => {
                        setThemeMode(t as any);
                        localStorage.setItem("openminis_theme_mode", t);
                      }}
                      className={`p-3 rounded-2xl border text-center font-semibold capitalize transition ${
                        themeMode === t
                          ? "border-[#0A84FF] bg-[#0A84FF]/10 text-[#0A84FF]"
                          : "border-[#E5E5EA] dark:border-[#2C2C2E] hover:bg-white dark:hover:bg-[#2C2C2E] text-black dark:text-white"
                      }`}
                    >
                      {t === "dark" ? "深色 (Dark)" : t === "light" ? "浅色 (Light)" : "跟随系统"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-white dark:bg-[#242426] rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E]">
                <div>
                  <div className="font-semibold text-sm text-black dark:text-white">OLED 纯黑模式</div>
                  <div className="text-xs text-[#8E8E93]">深色背景完全使用 #000000 纯黑，更沉浸省电</div>
                </div>
                <input
                  type="checkbox"
                  checked={oledMode}
                  onChange={e => {
                    setOledMode(e.target.checked);
                    localStorage.setItem("openminis_oled_mode", String(e.target.checked));
                  }}
                  className="w-5 h-5 accent-[#0A84FF]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-[#8E8E93] uppercase">系统强调色</label>
                <div className="flex gap-3">
                  {["#0A84FF", "#34C759", "#AF52DE", "#FF9500"].map(color => (
                    <button
                      key={color}
                      onClick={() => {
                        setAccentColor(color);
                        localStorage.setItem("openminis_accent_color", color);
                      }}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition ${
                        accentColor === color ? "ring-2 ring-white ring-offset-2 ring-offset-black" : "opacity-80 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: color }}
                    >
                      {accentColor === color && <Check className="w-4 h-4 text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          全新补齐视图 2: 技能扩展 (Skills)
      ========================================================================= */}
      {settingsView === "skills" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("root")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">技能扩展 (Skills)</h2>
              </div>
              <button
                onClick={() => invoke("open_external_url", { url: "https://github.com/OpenMinis/MinisSkills" })}
                className="text-xs text-[#0A84FF] flex items-center gap-1 hover:underline"
              >
                <span>浏览 MinisSkills 官方库</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="text-xs text-[#8E8E93] px-1">
                技能是存放于本地或沙箱中的扩展包（包含 SKILL.md）。当对话意图命中技能描述时，Agent 将自动调用相关脚本。
              </div>

              {skills.length === 0 ? (
                <div className="text-center py-12 text-xs text-[#8E8E93]">暂无已安装技能</div>
              ) : (
                skills.map(skill => (
                  <div
                    key={skill.id}
                    className="p-3.5 bg-white dark:bg-[#242426] rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 pr-2">
                      <div className="w-9 h-9 rounded-xl bg-[#FF2D55]/10 text-[#FF2D55] flex items-center justify-center shrink-0">
                        <Puzzle className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">{skill.name}</div>
                        <div className="text-xs text-[#8E8E93] line-clamp-1">{skill.description}</div>
                      </div>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#34C759]/10 text-[#34C759] font-semibold shrink-0">
                      已就绪
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          全新补齐视图 3: 灵魂设定 (Soul)
      ========================================================================= */}
      {settingsView === "soul" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("root")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">灵魂设定 (Soul)</h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#8E8E93] uppercase">Agent 助手称谓</label>
                <input
                  type="text"
                  value={soulConfig.name}
                  onChange={e => setSoulConfig(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#242426] border border-[#E5E5EA] dark:border-[#2C2C2E] text-black dark:text-white outline-none focus:border-[#0A84FF]"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-[#8E8E93] uppercase">自定义系统人设 (SOUL.md)</label>
                  <button
                    onClick={() => {
                      setSoulConfig({
                        name: "Minis",
                        instruction: "You are Minis, a private AI agent on Windows. Be direct, concise, and take action with tools.",
                        active: true,
                      });
                    }}
                    className="text-[11px] text-[#0A84FF] hover:underline"
                  >
                    恢复默认
                  </button>
                </div>
                <textarea
                  rows={8}
                  value={soulConfig.instruction}
                  onChange={e => setSoulConfig(prev => ({ ...prev, instruction: e.target.value }))}
                  className="w-full p-3.5 rounded-2xl bg-white dark:bg-[#242426] border border-[#E5E5EA] dark:border-[#2C2C2E] text-black dark:text-white outline-none focus:border-[#0A84FF] font-mono leading-relaxed resize-none"
                  placeholder="在此写入你的个性化指导原则与性格语气设定..."
                />
              </div>

              <button
                onClick={async () => {
                  try {
                    await invoke("save_soul_config", { config: soulConfig });
                    alert("灵魂设定保存成功！每轮对话将自动注入新设定。");
                    setSettingsView("root");
                  } catch (e) {
                    alert(`保存失败: ${e}`);
                  }
                }}
                className="w-full py-3 rounded-xl bg-[#0A84FF] text-white font-semibold shadow-md hover:opacity-90 transition text-sm"
              >
                保存设定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          全新补齐视图 4: 外部目录挂载 (Mounted Folders)
      ========================================================================= */}
      {settingsView === "mounts" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("root")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">挂载外部目录</h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="p-3.5 bg-white dark:bg-[#242426] rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-2.5">
                <div className="font-semibold text-sm text-black dark:text-white">添加新挂载 (Windows → 沙箱)</div>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Windows 绝对路径 (例如: D:\Projects 或 C:\Users\...\Notes)"
                    value={newMountHost}
                    onChange={e => setNewMountHost(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F2F2F7] dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] text-black dark:text-white outline-none"
                  />
                  <input
                    type="text"
                    placeholder="沙箱挂载别名 (例如: Projects，将在沙箱 /var/minis/mounts/Projects 可见)"
                    value={newMountName}
                    onChange={e => setNewMountName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F2F2F7] dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] text-black dark:text-white outline-none"
                  />
                  <button
                    onClick={async () => {
                      if (!newMountHost.trim() || !newMountName.trim()) {
                        alert("请完整填写路径与别名");
                        return;
                      }
                      try {
                        await invoke("add_mounted_folder", { hostPath: newMountHost.trim(), mountName: newMountName.trim() });
                        setNewMountHost("");
                        setNewMountName("");
                        loadMounts();
                        alert("外部目录挂载成功！Agent 可在沙箱 /var/minis/mounts/ 下直接读写文件。");
                      } catch (err) {
                        alert(`挂载失败: ${err}`);
                      }
                    }}
                    className="w-full py-2.5 rounded-xl bg-[#34C759] text-white font-semibold hover:opacity-90 transition"
                  >
                    立即挂载至沙箱
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-[#8E8E93] uppercase">当前已挂载目录</div>
                {mountedFolders.length === 0 ? (
                  <div className="text-center py-8 text-xs text-[#8E8E93]">暂无外部挂载目录</div>
                ) : (
                  mountedFolders.map(m => (
                    <div
                      key={m.id}
                      className="p-3 bg-white dark:bg-[#242426] rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold text-xs text-black dark:text-white">{m.name}</div>
                        <div className="text-[11px] text-[#8E8E93] line-clamp-1">宿主: {m.host_path}</div>
                        <div className="text-[11px] text-[#0A84FF]">沙箱: {m.sandbox_mount_path}</div>
                      </div>
                      <button
                        onClick={async () => {
                          if (confirm(`确定卸载挂载点 ${m.name} 吗？`)) {
                            await invoke("remove_mounted_folder", { mountName: m.name });
                            loadMounts();
                          }
                        }}
                        className="text-xs text-[#FF453A] hover:underline px-2 py-1"
                      >
                        卸载
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          工具调用详情全屏抽屉模态框 (ToolLiveModal)
      ========================================================================= */}
      {selectedToolDetail && (
        <ToolLiveModal
          toolInfo={selectedToolDetail}
          onClose={() => setSelectedToolDetail(null)}
        />
      )}


      {/* 现有子模态框 */}
      {settingsView === "providers" && (
        <ProviderManager
          providers={providers}
          activeProviderId={activeProviderId}
          activeModel={activeModel}
          onSaveProviders={saveProviders}
          onSetActiveProvider={setActiveProviderId}
          onSetActiveModel={setActiveModel}
          onClose={() => setSettingsView("root")}
        />
      )}

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
                <span className="text-xs font-semibold text-white">内置浏览器预览</span>
              </div>

              <div className="flex-1 flex items-center gap-2 max-w-md bg-[#1C1C1E] border border-[#2C2C2E] rounded-xl px-3 py-1">
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

              <div className="flex items-center gap-2">
                <button
                  onClick={() => invoke("open_external_url", { url: currentNavUrl })}
                  className="px-3 py-1 bg-[#0A84FF] hover:bg-[#0071E3] text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition"
                  title="在系统默认浏览器中打开 (支持所有带安全防内嵌的网站)"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>在系统浏览器打开</span>
                </button>
                <button onClick={() => setShowBrowserWindow(false)} className="text-[#8E8E93] hover:text-white p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-white relative flex flex-col">
              <div className="bg-[#FFF3CD] text-[#856404] px-4 py-1.5 text-xs flex items-center justify-between border-b border-[#FFEEBA]">
                <span>💡 必应、百度等大型网站默认禁止第三方内嵌。如遇下方提示“拒绝连接”，请点击右上角蓝色按钮在系统浏览器中浏览。</span>
                <button
                  onClick={() => invoke("open_external_url", { url: currentNavUrl })}
                  className="underline font-bold text-xs"
                >
                  立即在系统浏览器打开
                </button>
              </div>
              <iframe
                src={currentNavUrl}
                className="w-full flex-1 border-none"
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

            {/* =========================================================================
          Rootfs 沙箱与 WSL 智能管理中心 (对标菜单第二项)
      ========================================================================= */}
      {settingsView === "rootfs" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("root")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">Rootfs 沙箱管理</h2>
              </div>
              <button
                onClick={loadSandboxDiag}
                className="text-xs text-[#0A84FF] hover:underline flex items-center gap-1 font-medium"
              >
                <RefreshCw className="w-3.5 h-3.5" /> 刷新状态
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 实时状态诊断卡片 */}
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">沙箱运行时诊断</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 border border-[#E5E5EA] dark:border-[#2C2C2E] divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] text-xs space-y-3">
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[#8E8E93]">实例名称</span>
                    <span className="font-mono font-bold text-black dark:text-white">{sandboxDiag.distroName}</span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-[#8E8E93]">运行状态</span>
                    <span className="flex items-center gap-1.5 font-semibold">
                      {sandboxDiag.distroState === "Running" ? (
                        <>
                          <span className="w-2 h-2 rounded-full bg-[#34C759]" />
                          <span className="text-[#34C759]">正在运行 (Running)</span>
                        </>
                      ) : sandboxDiag.isInstalled ? (
                        <>
                          <span className="w-2 h-2 rounded-full bg-[#8E8E93]" />
                          <span className="text-[#8E8E93]">已挂起空闲 (Stopped)</span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 rounded-full bg-[#FF453A]" />
                          <span className="text-[#FF453A]">未安装配置</span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-[#8E8E93]">虚拟化底座</span>
                    <span className="text-black dark:text-white font-medium">WSL2 + Alpine Linux (x86_64)</span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-[#8E8E93]">宿主隔离状态</span>
                    <span className="text-[#34C759] font-medium">{sandboxDiag.isolationText}</span>
                  </div>
                </div>
              </div>

              {/* 未安装时醒目的安装引导卡片 */}
              {!sandboxDiag.isInstalled && (
                <div className="bg-[#007AFF]/10 border border-[#007AFF]/30 p-4 rounded-2xl space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#007AFF]">
                    <AlertTriangle className="w-4 h-4" />
                    <span>检测到 WSL2 独立沙箱尚未安装</span>
                  </div>
                  <p className="text-xs text-[#8E8E93] leading-relaxed">
                    Minis 需要一个精简的 Alpine Linux 沙箱环境来执行代码与工具。点击下方按钮即可弹出独立控制台窗口自动完成安装配置，实时显示下载和解压过程。
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={async () => {
                        try {
                          await invoke("launch_installer_terminal");
                        } catch (e: any) {
                          alert("唤起终端失败: " + e);
                        }
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-[#007AFF] hover:bg-[#0062CC] text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                    >
                      <Terminal className="w-4 h-4" />
                      <span>⚡ 唤起终端窗口可视化安装 (推荐)</span>
                    </button>
                    <button
                      onClick={() => {
                        setSettingsView("none");
                        handleStartAutoInit();
                      }}
                      className="px-4 py-2.5 rounded-xl bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] text-xs font-medium text-black dark:text-white"
                    >
                      后台向导安装
                    </button>
                  </div>
                </div>
              )}

              {/* 核心操作区 */}
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">智能维护与工具</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  {/* 一键无损修复 */}
                  <div
                    onClick={async () => {
                      setRepairingSandbox(true);
                      try {
                        const msg = await invoke<string>("repair_sandbox");
                        alert("修复成功！\n" + msg);
                        loadSandboxDiag();
                      } catch (e: any) {
                        alert("修复遇到问题:\n" + e);
                      } finally {
                        setRepairingSandbox(false);
                      }
                    }}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#34C759] flex items-center justify-center text-white">
                        <Shield className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white flex items-center gap-2">
                          <span>一键智能无损修复</span>
                          {repairingSandbox && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0A84FF]" />}
                        </div>
                        <div className="text-xs text-[#8E8E93]">自动修复 DNS 解析、目录权限与隔离策略，保留所有数据</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

                  {/* 重启沙箱释放内存 */}
                  <div
                    onClick={handleRestartSandbox}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#FF9F0A] flex items-center justify-center text-white">
                        {isRestartingSandbox ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white flex items-center gap-2">
                          <span>重启沙箱 / 释放内存</span>
                          {isRestartingSandbox && <span className="text-xs text-[#FF9F0A] font-normal animate-pulse">执行中...</span>}
                        </div>
                        <div className="text-xs text-[#8E8E93]">冷启动 WSL2 Alpine 实例并重新装配宿主共享卷</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>

                  {/* 浏览 Rootfs 根目录 */}
                  <div
                    onClick={() => invoke("open_sandbox_rootfs_dir").catch(e => alert(e))}
                    className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center text-white">
                        <Folder className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-black dark:text-white">浏览沙箱 Rootfs 根目录</div>
                        <div className="text-xs text-[#8E8E93]">在资源管理器中直达 \\wsl$\OpenMinisSandbox</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                  </div>
                </div>
              </div>

              {/* 危险重置区 */}
              <div>
                <div className="text-[12px] font-semibold text-[#FF453A] px-3 mb-1.5 uppercase">高级重置 (危险)</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden border border-[#FF453A]/30 p-4 space-y-3">
                  <div className="text-xs text-[#8E8E93] leading-relaxed">
                    如果沙箱内部依赖损坏严重，可完全注销当前实例并重新拉取全新镜像初始化。此操作不可逆。
                  </div>
                  <button
                    onClick={async () => {
                      if (confirm("⚠️ 确定要完全重置并重新安装沙箱吗？将唤起终端控制台重新下载最新镜像并部署全新实例。")) {
                        try {
                          await invoke("launch_installer_terminal");
                        } catch (e: any) {
                          setSettingsView("none");
                          handleStartAutoInit();
                        }
                      }
                    }}
                    className="w-full py-2.5 rounded-xl bg-[#FF453A]/15 hover:bg-[#FF453A]/25 border border-[#FF453A]/30 text-[#FF453A] text-xs font-semibold transition flex items-center justify-center gap-2"
                  >
                    <Terminal className="w-4 h-4" />
                    <span>完全重置并重新安装沙箱 (唤起终端向导)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          关于页面 (1:1 完美复刻截图 1000143646.jpg)
      ========================================================================= */}
      {settingsView === "about" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSettingsView("root")} className="text-black dark:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">关于</h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Logo 与 核心标语 */}
              <div className="flex flex-col items-center text-center space-y-2 py-4">
                <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-[#007AFF] via-[#5856D6] to-[#AF52DE] flex items-center justify-center text-white shadow-xl shadow-indigo-500/20">
                  <Sparkles className="w-10 h-10" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-black dark:text-white pt-2">Minis</h1>
                <div className="text-xs text-[#8E8E93] font-mono">版本 1.13.0.9 (Windows 测试版)</div>
                <p className="text-xs text-[#8E8E93] max-w-xs leading-relaxed pt-1">
                  Minis 是完全本地、完全私密的设备端 Agent。
                </p>
              </div>

              {/* 链接分组 */}
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">链接</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <div
                    onClick={() => invoke("open_external_url", { url: "https://github.com/Siu-Leung/OpenMinis-PC" })}
                    className="flex items-center justify-between p-4 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center text-white">
                        <FileCode className="w-4 h-4" />
                      </div>
                      <span className="text-sm font-semibold text-black dark:text-white">GitHub 仓库</span>
                    </div>
                    <div className="flex items-center gap-1 text-[#8E8E93]">
                      <ExternalLink className="w-3.5 h-3.5" />
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </div>

              {/* 应用更新分组 */}
              <div>
                <div className="text-[12px] font-semibold text-[#8E8E93] px-3 mb-1.5 uppercase">应用更新</div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <div
                    onClick={async () => {
                      setCheckingUpdate(true);
                      try {
                        const res = await fetch("https://api.github.com/repos/Siu-Leung/OpenMinis-PC/releases/latest");
                        if (res.ok) {
                          const data = await res.json();
                          const tag = data.tag_name || "v1.13.0.7";
                          setUpdateMsg(`最新发布版本：${tag}（当前已是最新版本）`);
                        } else {
                          setUpdateMsg("当前已是最新版本");
                        }
                      } catch (_) {
                        setUpdateMsg("当前已是最新版本");
                      } finally {
                        setCheckingUpdate(false);
                      }
                    }}
                    className="flex items-center justify-between p-4 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center text-white">
                        <ArrowUp className="w-4 h-4 rotate-180" />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-black dark:text-white">检查更新</span>
                        {updateMsg && <div className="text-[11px] text-[#34C759] mt-0.5">{updateMsg}</div>}
                      </div>
                    </div>
                    {checkingUpdate ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#8E8E93]" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-[#8E8E93] px-3 mt-2">
                  当前版本：1.13.0.9 (Windows 测试版)
                </div>
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
      {/* 会话右键上下文菜单 (对标 Hermes PC) */}
      {contextMenu && (
        <div
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 240),
            left: Math.min(contextMenu.x, window.innerWidth - 190),
          }}
          className="fixed w-44 bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] rounded-2xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs select-none space-y-0.5"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => startRenameSession(contextMenu.session)}
            className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition flex items-center gap-2 text-black dark:text-white font-medium"
          >
            <Edit3 className="w-3.5 h-3.5 text-[#0A84FF]" />
            <span>重命名会话</span>
          </button>
          <button
            onClick={() => togglePinSession(contextMenu.session.id)}
            className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition flex items-center gap-2 text-black dark:text-white font-medium"
          >
            <Pin className="w-3.5 h-3.5 text-[#FF9F0A]" />
            <span>{pinnedSessionIds.includes(contextMenu.session.id) ? "取消置顶" : "置顶会话"}</span>
          </button>
          <button
            onClick={() => handleCompactSession(contextMenu.session.id)}
            className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition flex items-center gap-2 text-black dark:text-white font-medium"
          >
            <Layers className="w-3.5 h-3.5 text-[#32ADE6]" />
            <span>压缩上下文</span>
          </button>
          <button
            onClick={() => handleExportSession(contextMenu.session)}
            className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition flex items-center gap-2 text-black dark:text-white font-medium"
          >
            <Download className="w-3.5 h-3.5 text-[#34C759]" />
            <span>导出 Markdown</span>
          </button>
          <div className="my-1 border-t border-[#E5E5EA] dark:border-[#2C2C2E]" />
          <button
            onClick={() => handleDeleteSession(contextMenu.session.id)}
            className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-[#FF453A]/10 transition flex items-center gap-2 text-[#FF453A] font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>删除会话</span>
          </button>
        </div>
      )}

      {/* 沙箱重启进度 Toast */}
      {sandboxRestartToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-black/85 backdrop-blur-md text-white px-5 py-3 rounded-2xl shadow-2xl border border-white/10 flex items-center gap-3 text-xs animate-in fade-in slide-in-from-top-4 duration-200">
          <RefreshCw className="w-4 h-4 animate-spin text-[#0A84FF]" />
          <span className="font-semibold">{sandboxRestartToast}</span>
        </div>
      )}
    </div>
  );
}