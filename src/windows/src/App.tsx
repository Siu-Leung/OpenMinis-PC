import { useState, useEffect, useRef } from "react";
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
  Sliders
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
  provider_url: string;
  api_key: string;
  model: string;
  thinking_level?: string; // "off" | "low" | "medium" | "high" | "max"
  thinking_budget?: number;
}

interface StreamEvent {
  event_type: "status" | "thinking" | "token" | "tool_start" | "tool_end" | "error";
  content: string;
}

interface SessionRecord {
  id: string;
  title: string;
  created_at: string;
  message_count: number;
  preview: string;
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

interface InitStepPayload {
  step: number;
  text: string;
  percent: number;
  done?: boolean;
}

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: "deepseek",
    name: "DeepSeek (深度求索)",
    provider_url: "https://api.deepseek.com",
    api_key: "",
    models: ["deepseek-chat", "deepseek-reasoner"]
  },
  {
    id: "openai",
    name: "OpenAI 官方",
    provider_url: "https://api.openai.com/v1",
    api_key: "",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"]
  },
  {
    id: "siliconflow",
    name: "硅基流动 (SiliconFlow)",
    provider_url: "https://api.siliconflow.cn/v1",
    api_key: "",
    models: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1"]
  },
  {
    id: "ollama",
    name: "本地 Ollama",
    provider_url: "http://localhost:11434/v1",
    api_key: "ollama",
    models: ["qwen2.5:latest", "deepseek-r1:latest"]
  }
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

  // 多供应商体系
  const [providers, setProviders] = useState<Provider[]>(() => {
    const saved = localStorage.getItem("openminis_providers_v2");
    return saved ? JSON.parse(saved) : DEFAULT_PROVIDERS;
  });
  const [activeProviderId, setActiveProviderId] = useState<string>(() => {
    return localStorage.getItem("openminis_active_provider_id") || "deepseek";
  });
  const [activeModel, setActiveModel] = useState<string>(() => {
    return localStorage.getItem("openminis_active_model") || "deepseek-chat";
  });
  const [thinkingLevel, setThinkingLevel] = useState<string>(() => {
    return localStorage.getItem("openminis_thinking_level") || "high";
  });

  // 对话状态流
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好，我是 **Minis**。\n\n运行于独立的 Alpine Linux 沙箱环境。已支持多供应商管理、深度思考链模式、MCP 扩展与图文文件联合分析。随时提出要求！"
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<"idle" | "connecting" | "thinking" | "answering">("idle");
  const [streamingText, setStreamingText] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [thinkingDuration, setThinkingDuration] = useState<number>(0);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);

  // 输入框待发附件
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 折叠卡片控制
  const [expandedThinking, setExpandedThinking] = useState<Record<number, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({});
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // 模态弹窗控制
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showProvidersModal, setShowProvidersModal] = useState(false);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [showGeneralSettings, setShowGeneralSettings] = useState(false);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [memoryText, setMemoryText] = useState("");

  // MCP 服务器列表
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  // 编辑供应商临时状态
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const thinkingTimerRef = useRef<any>(null);

  // 当前激活的 Provider
  const activeProvider = providers.find(p => p.id === activeProviderId) || providers[0];

  useEffect(() => {
    checkSandbox();
    refreshSessions();
    loadMcpServers();

    // 监听实时流式事件
    const unlistenStream = listen<StreamEvent>("agent-stream", (event) => {
      const payload = event.payload;
      if (payload.event_type === "status") {
        if (payload.content === "thinking") {
          setAgentStatus("thinking");
        } else if (payload.content === "answering") {
          setAgentStatus("answering");
        } else if (payload.content === "connecting") {
          setAgentStatus("connecting");
        }
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
      }
    });

    // 监听沙箱详细进度步进
    const unlistenInitStep = listen<InitStepPayload>("sandbox-init-step", (event) => {
      const data = event.payload;
      setInitPercent(data.percent);
      setInitCurrentText(data.text);
      setInitLogs(prev => [...prev, data.text]);
      if (data.done) {
        setSandboxReady(true);
        setSandboxNeedRestart(true);
      }
    });

    const unlistenInitErr = listen<string>("sandbox-init-error", (event) => {
      setInitError(event.payload);
      setInitLogs(prev => [...prev, `❌ 错误: ${event.payload}`]);
    });

    // 监听 Windows 资源管理器原生文件拖拽
    let unlistenWebviewDrop: (() => void) | undefined;
    try {
      getCurrentWebview().onDragDropEvent(async (event) => {
        if (event.payload.type === "drop") {
          setIsDraggingOver(false);
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            handleImportFilePaths(paths);
          }
        } else if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDraggingOver(true);
        } else if (event.payload.type === "leave") {
          setIsDraggingOver(false);
        }
      }).then(fn => { unlistenWebviewDrop = fn; });
    } catch (_) {}

    const unlistenDragDrop = listen<any>("tauri://drag-drop", (event) => {
      setIsDraggingOver(false);
      const paths = event.payload?.paths;
      if (paths && paths.length > 0) {
        handleImportFilePaths(paths);
      }
    });

    const unlistenDragEnter = listen<any>("tauri://drag-enter", () => setIsDraggingOver(true));
    const unlistenDragLeave = listen<any>("tauri://drag-leave", () => setIsDraggingOver(false));

    return () => {
      unlistenStream.then(un => un());
      unlistenInitStep.then(un => un());
      unlistenInitErr.then(un => un());
      if (unlistenWebviewDrop) unlistenWebviewDrop();
      unlistenDragDrop.then(un => un());
      unlistenDragEnter.then(un => un());
      unlistenDragLeave.then(un => un());
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, streamingThinking, activeToolName, agentStatus, attachments]);

  // 思考计时器
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

  const handleImportFilePaths = async (paths: string[]) => {
    try {
      const imported = await invoke<AttachmentItem[]>("import_local_files_by_path", { paths });
      setAttachments(prev => [...prev, ...imported]);
    } catch (err) {
      console.error("导入拖拽文件失败:", err);
    }
  };

  const saveProviders = (newProviders: Provider[]) => {
    setProviders(newProviders);
    localStorage.setItem("openminis_providers_v2", JSON.stringify(newProviders));
  };

  const switchActiveProvider = (provId: string) => {
    setActiveProviderId(provId);
    localStorage.setItem("openminis_active_provider_id", provId);
    const target = providers.find(p => p.id === provId);
    if (target && target.models.length > 0) {
      setActiveModel(target.models[0]);
      localStorage.setItem("openminis_active_model", target.models[0]);
    }
  };

  const switchActiveModel = (modelName: string) => {
    setActiveModel(modelName);
    localStorage.setItem("openminis_active_model", modelName);
  };

  const switchThinkingLevel = (level: string) => {
    setThinkingLevel(level);
    localStorage.setItem("openminis_thinking_level", level);
  };

  const loadMcpServers = async () => {
    try {
      const list = await invoke<McpServerItem[]>("list_mcp_servers");
      setMcpServers(list);
    } catch (_) {}
  };

  const handleToggleMcp = async (id: string) => {
    try {
      await invoke("toggle_mcp_server", { id });
      loadMcpServers();
    } catch (_) {}
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

  // 拖拽文件进入
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        processFile(e.dataTransfer.files[i]);
      }
    }
  };

  const processFile = (file: File) => {
    const isMedia = file.type.startsWith("image/");
    const sizeStr = file.size > 1024 * 1024 
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` 
      : `${Math.round(file.size / 1024)} KB`;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAttachments(prev => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          name: file.name,
          dataUrl,
          isMedia,
          sizeStr
        }
      ]);
    };
    reader.readAsDataURL(file);
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const checkSandbox = async () => {
    try {
      const ready = await invoke<boolean>("check_sandbox_status");
      setSandboxReady(ready);
    } catch (_) {
      setSandboxReady(false);
    }
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
    } catch (err: any) {
      setInitError(err?.toString() || "沙箱初始化发生异常");
    }
  };

  const handleFetchModelsForProvider = async (targetProv: Provider) => {
    if (!targetProv.provider_url) return;
    setFetchingModels(true);
    try {
      const list = await invoke<string[]>("fetch_provider_models", {
        providerUrl: targetProv.provider_url,
        apiKey: targetProv.api_key
      });
      const updated = providers.map(p => p.id === targetProv.id ? { ...p, models: list } : p);
      saveProviders(updated);
      if (targetProv.id === activeProviderId && list.length > 0) {
        switchActiveModel(list[0]);
      }
    } catch (err: any) {
      alert("自动获取模型列表失败: " + err);
    } finally {
      setFetchingModels(false);
    }
  };

  const refreshSessions = async () => {
    try {
      const list = await invoke<SessionRecord[]>("list_sessions");
      setSessions(list);
    } catch (_) {}
  };

  const handleLoadSession = async (id: string) => {
    try {
      const msgs = await invoke<ChatMessage[]>("get_session_messages", { id });
      setMessages(msgs);
      setCurrentSessionId(id);
    } catch (e) {
      alert("恢复会话失败: " + e);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await invoke("delete_session", { id });
      if (currentSessionId === id) {
        handleNewChat();
      }
      refreshSessions();
    } catch (_) {}
  };

  const handleNewChat = () => {
    setMessages([
      {
        role: "assistant",
        content: "已开启新会话。支持拖拽文件或粘贴截图，随时下达指令。"
      }
    ]);
    setCurrentSessionId(null);
    setInput("");
    setAttachments([]);
    setAgentStatus("idle");
    setStreamingText("");
    setStreamingThinking("");
  };

  // 关键：图文与文件联合发送
  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || loading) return;
    if (!activeProvider.api_key && activeProvider.id !== "ollama") {
      setShowProvidersModal(true);
      return;
    }

    const currentAttachments = [...attachments];
    setAttachments([]); // 清空输入栏待发附件列表

    let promptText = input.trim();
    const uploadedImages: string[] = [];
    const uploadedFiles: { name: string; url: string; sizeStr?: string }[] = [];

    // 保存文件到沙箱 (流式写入，突破字符数限制)
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
          promptText += `\n\n[附带文件已就绪: ${minisUrl} (${att.sizeStr})，可直接读取或运行分析]`;
        }
      } catch (err: any) {
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

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const currentConfig: AgentConfig = {
      provider_url: activeProvider.provider_url,
      api_key: activeProvider.api_key,
      model: activeModel,
      thinking_level: thinkingLevel,
    };

    try {
      const updated = await invoke<ChatMessage[]>("run_agent_turn", {
        config: currentConfig,
        sessionId: currentSessionId,
        messages: nextHistory
      });
      setMessages(updated);
      refreshSessions();
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

  const handleCopyCode = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1800);
  };

  const toggleToolExpand = (index: number) => {
    setExpandedTools(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const toggleThinkingExpand = (index: number) => {
    setExpandedThinking(prev => ({ ...prev, [index]: !prev[index] }));
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
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      className="flex h-screen w-screen bg-[#000000] text-[#FFFFFF] font-sans antialiased overflow-hidden select-none relative"
    >
      {/* 拖拽文件进入悬浮提示框 */}
      {isDraggingOver && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-8 border-2 border-dashed border-[#0A84FF] rounded-2xl m-3 pointer-events-none transition-all">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#0A84FF]/20 flex items-center justify-center text-[#0A84FF]">
              <Plus className="w-7 h-7" />
            </div>
            <div className="text-base font-semibold text-white">松开鼠标，将文件附加到输入框</div>
            <div className="text-xs text-[#8E8E93]">支持拖入图片直接多模态视觉分析，支持代码、文档与数据集直接写入沙箱</div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files) {
            for (let i = 0; i < e.target.files.length; i++) {
              processFile(e.target.files[i]);
            }
          }
        }}
      />

      {/* ======================= 原版 Minis 极简侧边栏 ======================= */}
      {sidebarOpen && (
        <aside className="w-[260px] h-full bg-[#000000] border-r border-[#1C1C1E] flex flex-col justify-between p-3 shrink-0 z-20">
          <div className="flex flex-col h-full min-h-0">
            {/* 顶栏：Minis Title 与新对话 */}
            <div className="flex items-center justify-between px-2 py-1 mb-3">
              <span className="text-xs font-semibold tracking-wider text-[#8E8E93] uppercase">Minis</span>
              <button
                onClick={handleNewChat}
                className="p-1.5 rounded-lg text-[#8E8E93] hover:text-[#FFFFFF] hover:bg-[#1C1C1E] transition"
                title="开启新会话"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* 会话搜索 */}
            <div className="relative mb-3 px-1">
              <Search className="w-3.5 h-3.5 text-[#636366] absolute left-3.5 top-2.5" />
              <input
                type="text"
                value={sessionSearch}
                onChange={e => setSessionSearch(e.target.value)}
                placeholder="搜索会话..."
                className="w-full bg-[#1C1C1E] border border-[#2C2C2E] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#FFFFFF] placeholder-[#636366] focus:outline-none focus:border-[#3A3A3C] transition"
              />
            </div>

            {/* 历史会话列表 */}
            <div className="flex-1 overflow-y-auto space-y-1 px-1 min-h-0 pr-1">
              {sessions
                .filter(s => !sessionSearch || s.title.toLowerCase().includes(sessionSearch.toLowerCase()))
                .map(s => (
                  <div
                    key={s.id}
                    onClick={() => handleLoadSession(s.id)}
                    className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition ${
                      currentSessionId === s.id
                        ? "bg-[#1C1C1E] text-[#FFFFFF] font-medium"
                        : "text-[#8E8E93] hover:bg-[#141416] hover:text-[#D1D1D6]"
                    }`}
                  >
                    <span className="truncate flex-1 pr-2">{s.title}</span>
                    <button
                      onClick={(e) => handleDeleteSession(e, s.id)}
                      className="opacity-0 group-hover:opacity-100 text-[#636366] hover:text-[#FF453A] p-0.5 transition"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
            </div>

            {/* 底部功能菜单：清晰分离 供应商管理 与 通用设置 */}
            <div className="border-t border-[#1C1C1E] pt-3 mt-2 space-y-1 px-1">
              <button
                onClick={() => setShowProvidersModal(true)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-[#8E8E93] hover:bg-[#1C1C1E] hover:text-[#FFFFFF] transition"
              >
                <div className="flex items-center gap-2.5 truncate">
                  <Server className="w-3.5 h-3.5 text-[#0A84FF]" />
                  <span className="truncate">{activeProvider.name}</span>
                </div>
                <span className="text-[10px] text-[#636366] font-mono shrink-0">供应商</span>
              </button>

              <button
                onClick={() => setShowMcpModal(true)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-[#8E8E93] hover:bg-[#1C1C1E] hover:text-[#FFFFFF] transition"
              >
                <div className="flex items-center gap-2.5">
                  <Layers className="w-3.5 h-3.5 text-[#BF5AF2]" />
                  <span>MCP 工具集</span>
                </div>
                <span className="text-[10px] text-[#636366]">{mcpServers.filter(s => s.enabled).length} 已启用</span>
              </button>

              <button
                onClick={() => invoke("open_sandbox_dir").catch(e => alert(e))}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#8E8E93] hover:bg-[#1C1C1E] hover:text-[#FFFFFF] transition"
              >
                <ExternalLink className="w-3.5 h-3.5" /> 浏览沙箱文件
              </button>

              <button
                onClick={() => invoke("launch_interactive_terminal").catch(e => alert(e))}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#8E8E93] hover:bg-[#1C1C1E] hover:text-[#FFFFFF] transition"
              >
                <Terminal className="w-3.5 h-3.5" /> 交互终端 (SSH)
              </button>

              <button
                onClick={() => setShowGeneralSettings(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#8E8E93] hover:bg-[#1C1C1E] hover:text-[#FFFFFF] transition"
              >
                <SettingsIcon className="w-3.5 h-3.5" /> 通用偏好设置
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* ======================= 主对话区域 ======================= */}
      <main className="flex-1 flex flex-col h-full bg-[#000000] relative">
        {/* 顶部导航栏：模型胶囊与思考强度切换 */}
        <header className="h-[52px] border-b border-[#1C1C1E] flex items-center justify-between px-4 shrink-0 bg-[#000000]/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg text-[#8E8E93] hover:text-[#FFFFFF] hover:bg-[#1C1C1E] transition"
              title="切换侧边栏"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          </div>

          {/* 顶栏中心：原版 Minis 模型与思考强度胶囊 */}
          <div className="relative">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1C1C1E] border border-[#2C2C2E] hover:border-[#3A3A3C] text-xs font-medium text-[#FFFFFF] transition shadow-sm"
            >
              {thinkingLevel !== "off" && (
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#0A84FF]/20 text-[#0A84FF] font-mono">
                  🧠 {thinkingLevel.toUpperCase()}
                </span>
              )}
              <span className="truncate max-w-[180px]">{activeModel || "选择模型"}</span>
              <ChevronDown className="w-3 h-3 text-[#8E8E93]" />
            </button>

            {/* 模型与思考强度下拉 */}
            {showModelPicker && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 w-72 bg-[#1C1C1E] border border-[#2C2C2E] rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                {/* 思考强度调节 */}
                <div className="px-2 py-1.5 border-b border-[#2C2C2E] mb-2 space-y-1.5">
                  <div className="text-[11px] font-semibold text-[#8E8E93] flex items-center gap-1">
                    <Sliders className="w-3 h-3" /> 思考模式强度
                  </div>
                  <div className="flex rounded-lg bg-[#141416] p-0.5 border border-[#2C2C2E] text-[10px]">
                    {["off", "low", "medium", "high"].map(lvl => (
                      <button
                        key={lvl}
                        onClick={() => switchThinkingLevel(lvl)}
                        className={`flex-1 py-1 rounded-md capitalize transition ${
                          thinkingLevel === lvl ? "bg-[#0A84FF] text-white font-medium" : "text-[#8E8E93] hover:text-white"
                        }`}
                      >
                        {lvl === "off" ? "关闭" : lvl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 供应商与可用模型 */}
                <div className="flex items-center justify-between px-2 py-1 border-b border-[#2C2C2E] mb-1">
                  <span className="text-[11px] font-semibold text-[#8E8E93]">{activeProvider.name} 模型</span>
                  <button
                    onClick={() => handleFetchModelsForProvider(activeProvider)}
                    disabled={fetchingModels}
                    className="text-[10px] text-[#0A84FF] hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${fetchingModels ? "animate-spin" : ""}`} /> 刷新
                  </button>
                </div>
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {activeProvider.models.length === 0 ? (
                    <div className="text-center py-4 text-xs text-[#636366]">
                      暂无模型，请点击上方刷新自动拉取
                    </div>
                  ) : (
                    activeProvider.models.map(m => (
                      <button
                        key={m}
                        onClick={() => {
                          switchActiveModel(m);
                          setShowModelPicker(false);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs truncate transition flex items-center justify-between ${
                          activeModel === m ? "bg-[#0A84FF] text-white" : "text-[#D1D1D6] hover:bg-[#2C2C2E]"
                        }`}
                      >
                        <span className="truncate">{m}</span>
                        {activeModel === m && <Check className="w-3 h-3" />}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleNewChat}
              className="p-1.5 rounded-lg text-[#8E8E93] hover:text-[#FFFFFF] hover:bg-[#1C1C1E] transition"
              title="新建对话"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 顶部沙箱提示条 */}
        {sandboxNeedRestart ? (
          <div className="bg-[#1C1C1E] border-b border-[#2C2C2E] px-4 py-2 flex items-center justify-between text-xs z-10">
            <div className="flex items-center gap-2 text-[#34C759]">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>沙箱已配置成功，重启软件后完全载入隔离环境</span>
            </div>
            <button
              onClick={() => invoke("restart_app").catch(() => window.location.reload())}
              className="bg-[#0A84FF] hover:bg-[#0071E3] text-white px-3 py-1 rounded-full font-medium transition flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" /> 立即重启生效
            </button>
          </div>
        ) : !sandboxReady && (
          <div className="bg-[#1C1C1E] border-b border-[#2C2C2E] px-4 py-2.5 flex items-center justify-between text-xs z-10">
            <div className="flex items-center gap-2 text-[#FF9F0A]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>WSL2 独立沙箱尚未安装或未完成配置</span>
            </div>
            <button
              onClick={handleStartAutoInit}
              className="bg-[#0A84FF] hover:bg-[#0071E3] text-white px-3.5 py-1 rounded-full font-medium transition shrink-0"
            >
              一键全自动配置沙箱
            </button>
          </div>
        )}

        {/* ======================= 对话消息流 ======================= */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg, i) => {
              if (msg.role === "system") return null;

              // 工具调用胶囊
              if (msg.role === "tool") {
                const info = getToolDisplayInfo(msg.content);
                const IconComponent = info.icon;
                const isExpanded = !!expandedTools[i];

                return (
                  <div key={i} className="my-2">
                    <div
                      onClick={() => toggleToolExpand(i)}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#141416] border border-[#2C2C2E] hover:border-[#38383A] text-xs text-[#8E8E93] cursor-pointer transition select-none"
                    >
                      <IconComponent className={`w-3.5 h-3.5 ${info.color}`} />
                      <span className="font-mono text-[11px] text-[#D1D1D6]">{info.label}</span>
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </div>

                    {isExpanded && (
                      <div className="mt-2 p-3 rounded-2xl bg-[#141416] border border-[#2C2C2E] text-xs font-mono relative overflow-x-auto text-[#C7C7CC]">
                        <button
                          onClick={() => handleCopyCode(info.detail, i)}
                          className="absolute top-2.5 right-2.5 p-1 rounded hover:bg-[#2C2C2E] text-[#8E8E93] transition"
                          title="复制代码"
                        >
                          {copiedIndex === i ? <Check className="w-3.5 h-3.5 text-[#34C759]" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <pre className="whitespace-pre-wrap selection:bg-[#2C2C2E]">{info.detail}</pre>
                      </div>
                    )}
                  </div>
                );
              }

              // 用户消息：支持多图与文件胶囊
              if (msg.role === "user") {
                return (
                  <div key={i} className="flex flex-col items-end space-y-2">
                    {/* 附带图片网格 */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end max-w-[80%]">
                        {msg.images.map((img, idx) => (
                          <img key={idx} src={img} alt="upload" className="max-h-56 max-w-sm rounded-xl border border-[#2C2C2E] object-cover shadow-sm" />
                        ))}
                      </div>
                    )}

                    {/* 附带文件胶囊 */}
                    {msg.files && msg.files.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end max-w-[80%]">
                        {msg.files.map((f, idx) => (
                          <div key={idx} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1C1C1E] border border-[#2C2C2E] text-xs text-[#D1D1D6]">
                            <FileText className="w-3.5 h-3.5 text-[#32ADE6]" />
                            <span>{f.name}</span>
                            {f.sizeStr && <span className="text-[#8E8E93] text-[10px]">({f.sizeStr})</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="bg-[#1C1C1E] border border-[#2C2C2E] text-[#FFFFFF] rounded-[20px] rounded-br-[6px] px-4 py-2.5 max-w-[80%] text-sm leading-relaxed shadow-sm">
                      {msg.content}
                    </div>
                  </div>
                );
              }

              // 助手消息：原生左对齐排版 + 思考链折叠块
              return (
                <div key={i} className="flex flex-col space-y-2 text-[#E5E5EA] text-[15px] leading-relaxed select-text">
                  {/* 历史思考链折叠卡片 */}
                  {msg.thinking && (
                    <div className="mb-1">
                      <div
                        onClick={() => toggleThinkingExpand(i)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#141416] border border-[#2C2C2E] hover:border-[#38383A] text-xs text-[#8E8E93] cursor-pointer transition select-none"
                      >
                        <Brain className="w-3.5 h-3.5 text-[#0A84FF]" />
                        <span>已思考 {msg.thinking_duration ? `${msg.thinking_duration.toFixed(1)} 秒` : ""}</span>
                        {expandedThinking[i] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </div>

                      {expandedThinking[i] && (
                        <div className="mt-2 p-3.5 rounded-2xl bg-[#141416] border border-[#2C2C2E] text-xs font-mono text-[#8E8E93] leading-relaxed whitespace-pre-wrap selection:bg-[#2C2C2E]">
                          {msg.thinking}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                </div>
              );
            })}

            {/* 正在思考中实时流 (Thinking Block) */}
            {loading && streamingThinking && (
              <div className="flex flex-col space-y-2 text-[#8E8E93]">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#141416] border border-[#0A84FF]/40 text-xs text-[#0A84FF] animate-pulse">
                  <Brain className="w-3.5 h-3.5 animate-spin" />
                  <span>正在深度思考 ({thinkingDuration.toFixed(1)}s)...</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-[#141416] border border-[#2C2C2E] text-xs font-mono text-[#8E8E93] leading-relaxed whitespace-pre-wrap">
                  {streamingThinking}
                </div>
              </div>
            )}

            {/* 正文流式打字机 */}
            {loading && streamingText && (
              <div className="flex flex-col space-y-2 text-[#E5E5EA] text-[15px] leading-relaxed select-text">
                <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingText}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* 动态回复中 / 输入中状态指示器 (用户明确要求) */}
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
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#141416] border border-[#2C2C2E] text-[11px] text-[#8E8E93] animate-pulse">
                <Terminal className="w-3 h-3 text-[#34C759] animate-spin" />
                <span>{activeToolName}</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        {/* ======================= 原版 Minis 标志性胶囊输入栏 (图文混排) ======================= */}
        <div className="p-4 shrink-0 bg-gradient-to-t from-[#000000] via-[#000000] to-transparent">
          <div className="max-w-3xl mx-auto bg-[#1C1C1E] border border-[#2C2C2E] rounded-[24px] px-3.5 py-2 flex flex-col gap-2 focus-within:border-[#3A3A3C] transition shadow-xl">
            
            {/* 上方附件暂存预览条 (可点 ✕ 删除，文字与附件共存) */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1 border-b border-[#2C2C2E] pb-2">
                {attachments.map(att => (
                  <div key={att.id} className="relative group flex items-center gap-2 p-1.5 bg-[#141416] border border-[#2C2C2E] rounded-xl text-xs">
                    {att.isMedia ? (
                      <img src={att.dataUrl} alt={att.name} className="w-10 h-10 rounded-lg object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-[#2C2C2E] flex items-center justify-center">
                        <FileText className="w-5 h-5 text-[#32ADE6]" />
                      </div>
                    )}
                    <div className="max-w-[120px] truncate text-[11px] pr-4">
                      <div className="truncate text-white font-medium">{att.name}</div>
                      <div className="text-[10px] text-[#8E8E93]">{att.sizeStr}</div>
                    </div>
                    <button
                      onClick={() => removeAttachment(att.id)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#2C2C2E] hover:bg-[#FF453A] rounded-full flex items-center justify-center text-white transition"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* 文件上传触发按钮 (+) */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#8E8E93] hover:text-white hover:bg-[#2C2C2E] transition shrink-0 mb-0.5"
                title="上传文件或图片 (支持多选、拖拽或直接按 Ctrl+V 粘贴截图)"
              >
                <Plus className="w-4 h-4" />
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
                placeholder={attachments.length > 0 ? "输入对上述文件的分析要求..." : "发送消息、粘贴截图 (Ctrl+V) 或拖入文件..."}
                className="flex-1 bg-transparent border-none text-sm text-[#FFFFFF] placeholder-[#636366] focus:outline-none resize-none max-h-40 py-1"
              />

              {/* 原版圆钮发送键 (arrow.up.circle.fill) */}
              <button
                onClick={handleSend}
                disabled={loading || (!input.trim() && attachments.length === 0)}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition shrink-0 mb-0.5 ${
                  (input.trim() || attachments.length > 0) && !loading
                    ? "bg-[#FFFFFF] text-[#000000] hover:bg-[#E5E5EA]"
                    : "bg-[#2C2C2E] text-[#636366] cursor-not-allowed"
                }`}
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* ======================= 多供应商管理模态框 (Providers Modal) ======================= */}
      {showProvidersModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#1C1C1E] border border-[#2C2C2E] w-full max-w-xl rounded-2xl p-6 shadow-2xl space-y-5 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[#2C2C2E]">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Server className="w-4 h-4 text-[#0A84FF]" />
                <span>AI 供应商配置管理</span>
              </div>
              <button onClick={() => setShowProvidersModal(false)} className="text-[#8E8E93] hover:text-white text-xs">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {providers.map(p => {
                const isActive = p.id === activeProviderId;
                return (
                  <div
                    key={p.id}
                    className={`p-4 rounded-xl border transition ${
                      isActive ? "bg-[#141416] border-[#0A84FF]" : "bg-[#141416]/60 border-[#2C2C2E]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-white">{p.name}</span>
                        {isActive && (
                          <span className="text-[10px] bg-[#0A84FF]/20 text-[#0A84FF] px-2 py-0.5 rounded-full font-medium">
                            当前主力
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!isActive && (
                          <button
                            onClick={() => switchActiveProvider(p.id)}
                            className="text-xs text-[#0A84FF] hover:underline"
                          >
                            设为当前
                          </button>
                        )}
                        <button
                          onClick={() => handleFetchModelsForProvider(p)}
                          disabled={fetchingModels}
                          className="text-xs text-[#8E8E93] hover:text-white flex items-center gap-1"
                        >
                          <RefreshCw className={`w-3 h-3 ${fetchingModels ? "animate-spin" : ""}`} /> 自动拉取模型
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div>
                        <label className="block text-[11px] text-[#8E8E93] mb-0.5">Base URL</label>
                        <input
                          type="text"
                          value={p.provider_url}
                          onChange={e => {
                            const updated = providers.map(item => item.id === p.id ? { ...item, provider_url: e.target.value } : item);
                            saveProviders(updated);
                          }}
                          className="w-full bg-[#1C1C1E] border border-[#2C2C2E] rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-[#0A84FF]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-[#8E8E93] mb-0.5">API Key</label>
                        <input
                          type="password"
                          value={p.api_key}
                          onChange={e => {
                            const updated = providers.map(item => item.id === p.id ? { ...item, api_key: e.target.value } : item);
                            saveProviders(updated);
                          }}
                          placeholder="sk-..."
                          className="w-full bg-[#1C1C1E] border border-[#2C2C2E] rounded-lg px-3 py-1.5 text-white font-mono focus:outline-none focus:border-[#0A84FF]"
                        />
                      </div>
                      <div className="text-[11px] text-[#8E8E93]">
                        可用模型: <span className="text-white">{p.models.join(", ") || "未拉取，请点击右上角自动拉取"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-[#2C2C2E]">
              <button
                onClick={() => {
                  const newId = `custom-${Date.now().toString(36)}`;
                  const newP: Provider = {
                    id: newId,
                    name: "自定义供应商",
                    provider_url: "https://api.example.com/v1",
                    api_key: "",
                    models: []
                  };
                  saveProviders([...providers, newP]);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-[#2C2C2E] hover:bg-[#38383A] text-xs text-white transition flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> 添加新供应商
              </button>
              <button
                onClick={() => setShowProvidersModal(false)}
                className="px-5 py-1.5 rounded-full bg-[#0A84FF] hover:bg-[#0071E3] text-xs font-semibold text-white transition"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================= MCP 扩展服务管理模态框 ======================= */}
      {showMcpModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#1C1C1E] border border-[#2C2C2E] w-full max-w-xl rounded-2xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[#2C2C2E]">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Layers className="w-4 h-4 text-[#BF5AF2]" />
                <span>MCP (Model Context Protocol) 扩展协议</span>
              </div>
              <button onClick={() => setShowMcpModal(false)} className="text-[#8E8E93] hover:text-white text-xs">✕</button>
            </div>

            <div className="text-xs text-[#8E8E93] leading-relaxed">
              支持连接外部 MCP 服务器（通过 Stdio 或 HTTP/SSE 协议），模型将自动识别并调用其注册的专业 Tools。
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {mcpServers.map(s => (
                <div key={s.id} className="p-3.5 bg-[#141416] border border-[#2C2C2E] rounded-xl flex items-center justify-between">
                  <div className="flex-1 min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-white truncate">{s.name}</span>
                      <span className="text-[10px] bg-[#2C2C2E] text-[#D1D1D6] px-1.5 py-0.2 rounded font-mono uppercase">
                        {s.server_type}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#8E8E93] truncate font-mono mt-1">{s.command_or_url}</div>
                    {s.description && <div className="text-[10px] text-[#636366] mt-0.5">{s.description}</div>}
                  </div>
                  <button
                    onClick={() => handleToggleMcp(s.id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                      s.enabled ? "bg-[#34C759]/20 text-[#34C759] border border-[#34C759]/40" : "bg-[#2C2C2E] text-[#8E8E93]"
                    }`}
                  >
                    {s.enabled ? "已启用" : "已停用"}
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-[#2C2C2E]">
              <button
                onClick={() => setShowMcpModal(false)}
                className="px-5 py-1.5 rounded-full bg-[#0A84FF] hover:bg-[#0071E3] text-xs font-semibold text-white transition"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================= 通用偏好设置模态框 ======================= */}
      {showGeneralSettings && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#1C1C1E] border border-[#2C2C2E] w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#2C2C2E]">
              <h2 className="text-sm font-semibold text-white">通用偏好设置</h2>
              <button onClick={() => setShowGeneralSettings(false)} className="text-[#8E8E93] hover:text-white text-xs">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-[#141416] border border-[#2C2C2E] space-y-2">
                <div className="font-semibold text-white">WSL2 沙箱资源管理</div>
                <div className="text-[#8E8E93] text-[11px] leading-relaxed">
                  沙箱闲置时内存会自动回收。如需彻底释放，可点击立即挂起沙箱。
                </div>
                <button
                  onClick={async () => {
                    await invoke("terminate_sandbox");
                    alert("已挂起沙箱并彻底释放全部系统内存！下次执行时将自动唤醒。");
                  }}
                  className="w-full py-1.5 rounded-lg bg-[#2C2C2E] hover:bg-[#38383A] text-white text-xs transition"
                >
                  立即挂起沙箱释放内存
                </button>
              </div>

              <div className="p-3 rounded-xl bg-[#141416] border border-[#2C2C2E] space-y-2">
                <div className="font-semibold text-white">持久化记忆系统</div>
                <div className="text-[#8E8E93] text-[11px] leading-relaxed">
                  跨会话沉淀事实与用户偏好。支持查看今日记忆库。
                </div>
                <button
                  onClick={() => {
                    invoke<string>("get_today_memory").then(t => setMemoryText(t)).catch(e => setMemoryText(e));
                    setShowMemoryModal(true);
                  }}
                  className="w-full py-1.5 rounded-lg bg-[#2C2C2E] hover:bg-[#38383A] text-white text-xs transition"
                >
                  查看今日记忆日志 (YYYY-MM-DD.md)
                </button>
              </div>

              <div className="text-[11px] text-[#636366] text-center pt-2">
                OpenMinis for Windows · v1.13.0.2 (完全加固原生版)
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-[#2C2C2E]">
              <button
                onClick={() => setShowGeneralSettings(false)}
                className="px-5 py-1.5 rounded-full bg-[#0A84FF] hover:bg-[#0071E3] text-xs font-semibold text-white transition"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================= 可视化沙箱向导模态框 ======================= */}
      {showInitModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#1C1C1E] border border-[#2C2C2E] w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#2C2C2E]">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Terminal className="w-4 h-4 text-[#34C759]" />
                <span>WSL2 Alpine 隔离沙箱配置向导</span>
              </div>
              {!initError && initPercent === 100 && (
                <button onClick={() => setShowInitModal(false)} className="text-[#8E8E93] hover:text-white text-xs">✕</button>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs text-[#8E8E93]">
                <span>{initCurrentText}</span>
                <span className="font-mono text-white">{initPercent}%</span>
              </div>
              <div className="w-full bg-[#141416] h-2 rounded-full overflow-hidden border border-[#2C2C2E]">
                <div
                  className={`h-full transition-all duration-300 ${initError ? "bg-[#FF453A]" : "bg-[#0A84FF]"}`}
                  style={{ width: `${initPercent}%` }}
                />
              </div>
            </div>

            <div className="bg-[#141416] border border-[#2C2C2E] rounded-xl p-3 h-44 overflow-y-auto font-mono text-[11px] text-[#A1A1A6] space-y-1">
              {initLogs.map((log, i) => (
                <div key={i} className="leading-relaxed">
                  {log}
                </div>
              ))}
            </div>

            {/* 成功后突出显示重启提示卡片 */}
            {!initError && initPercent === 100 && (
              <div className="p-4 bg-[#34C759]/10 border border-[#34C759]/30 rounded-2xl text-xs space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#34C759]">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span>WSL2 独立沙箱已完全初始化成功！</span>
                </div>
                <p className="text-[#E5E5EA] leading-relaxed">
                  已成功导入 Alpine 隔离沙箱并写入零信任宿主隔离规则 (/etc/wsl.conf)。为确保隔离策略、网络与环境变量完全生效，<strong>强烈建议重启软件</strong>。
                </p>
                <div className="text-[11px] text-[#8E8E93] bg-[#141416] p-2.5 rounded-xl border border-[#2C2C2E] leading-relaxed">
                  💡 <strong>提示</strong>：如果您的 Windows 电脑是首次开启 WSL2 功能，重启软件后如遇任何沙箱连接异常，建议重启一次 Windows 计算机。
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => invoke("restart_app").catch(() => window.location.reload())}
                    className="flex-1 py-2 rounded-xl bg-[#0A84FF] hover:bg-[#0071E3] text-white font-medium text-xs transition flex items-center justify-center gap-1.5 shadow-lg shadow-blue-500/20"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> 立即重启软件生效
                  </button>
                  <button
                    onClick={() => setShowInitModal(false)}
                    className="px-4 py-2 rounded-xl bg-[#2C2C2E] hover:bg-[#3A3A3C] text-[#8E8E93] hover:text-white text-xs transition"
                  >
                    稍后手动重启
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              {initError ? (
                <>
                  <button
                    onClick={() => setShowInitModal(false)}
                    className="px-4 py-1.5 rounded-full bg-[#2C2C2E] hover:bg-[#38383A] text-xs text-[#8E8E93] hover:text-white transition"
                  >
                    关闭
                  </button>
                  <button
                    onClick={handleStartAutoInit}
                    className="px-4 py-1.5 rounded-full bg-[#0A84FF] hover:bg-[#0071E3] text-xs font-medium text-white transition flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> 重新尝试
                  </button>
                </>
              ) : initPercent === 100 ? null : (
                <div className="text-xs text-[#8E8E93] flex items-center gap-2 py-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>全自动部署中，无需任何手工操作...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================= 记忆查看抽屉 ======================= */}
      {showMemoryModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1C1C1E] border border-[#2C2C2E] w-full max-w-lg rounded-2xl p-5 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between pb-3 border-b border-[#2C2C2E]">
              <span className="text-sm font-semibold text-white">持久化记忆存储</span>
              <button onClick={() => setShowMemoryModal(false)} className="text-[#8E8E93] hover:text-white text-xs">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto my-3 text-xs font-mono text-[#A1A1A6] whitespace-pre-wrap bg-[#141416] p-3 rounded-xl border border-[#2C2C2E]">
              {memoryText || "今日暂无记录"}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setShowMemoryModal(false)}
                className="bg-[#2C2C2E] hover:bg-[#38383A] text-white px-4 py-1.5 rounded-full text-xs transition"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
