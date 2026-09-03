import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  Clock,
  Brain,
  Globe,
  FileText,
  AlertTriangle,
  RefreshCw,
  X,
  Paperclip,
  Image as ImageIcon,
  CheckCircle2,
  Loader2
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_calls?: any;
  tool_call_id?: string;
  images?: string[];
  files?: { name: string; url: string }[];
}

interface AgentConfig {
  provider_url: string;
  api_key: string;
  model: string;
}

interface StreamEvent {
  event_type: "token" | "tool_start" | "tool_end" | "error";
  content: string;
}

interface SessionRecord {
  id: string;
  title: string;
  created_at: string;
  message_count: number;
  preview: string;
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

export default function App() {
  const [sandboxReady, setSandboxReady] = useState<boolean>(true);
  const [showInitModal, setShowInitModal] = useState<boolean>(false);
  const [initPercent, setInitPercent] = useState<number>(0);
  const [initCurrentText, setInitCurrentText] = useState<string>("准备中...");
  const [initLogs, setInitLogs] = useState<string[]>([]);
  const [initError, setInitError] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好，我是 **Minis**。\n\n运行于独立的 Alpine Linux 沙箱环境，支持浏览器自动化、代码执行、文件分析与图片多模态。支持拖拽或粘贴图片/文件到输入框直接分析。"
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeToolName, setActiveToolName] = useState<string | null>(null);

  // 待发送附件列表 (支持多模态图片与文件)
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 折叠工具卡片状态
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({});
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // 顶部模型选择下拉菜单
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  // 设置模态框
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<AgentConfig>(() => {
    const saved = localStorage.getItem("openminis_config");
    return saved ? JSON.parse(saved) : {
      provider_url: "https://api.openai.com/v1",
      api_key: "",
      model: "gpt-4o"
    };
  });

  // 会话列表
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");

  // 记忆查看抽屉
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [memoryText, setMemoryText] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    checkSandbox();

    const cachedModels = localStorage.getItem("openminis_cached_models");
    if (cachedModels) {
      try { setAvailableModels(JSON.parse(cachedModels)); } catch (_) {}
    }

    refreshSessions();

    // 监听实时流式事件
    const unlistenStream = listen<StreamEvent>("agent-stream", (event) => {
      const payload = event.payload;
      if (payload.event_type === "token") {
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
        setTimeout(() => setShowInitModal(false), 1200);
      }
    });

    // 监听沙箱初始化错误
    const unlistenInitErr = listen<string>("sandbox-init-error", (event) => {
      setInitError(event.payload);
      setInitLogs(prev => [...prev, `❌ 错误: ${event.payload}`]);
    });

    return () => {
      unlistenStream.then(un => un());
      unlistenInitStep.then(un => un());
      unlistenInitErr.then(un => un());
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, activeToolName, attachments]);

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

  // 拖拽文件进入聊天框
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
    setInitCurrentText("正在准备沙箱配置环境...");
    setInitLogs(["正在启动 WSL2 Alpine 沙箱自动初始化..."]);
    setInitError(null);

    try {
      await invoke("auto_initialize_sandbox");
      setSandboxReady(true);
    } catch (err: any) {
      setInitError(err?.toString() || "沙箱初始化发生异常");
    }
  };

  const handleFetchModels = async () => {
    if (!config.provider_url) return;
    setFetchingModels(true);
    try {
      const list = await invoke<string[]>("fetch_provider_models", {
        providerUrl: config.provider_url,
        apiKey: config.api_key
      });
      setAvailableModels(list);
      localStorage.setItem("openminis_cached_models", JSON.stringify(list));
      if (list.length > 0 && !list.includes(config.model)) {
        updateConfig({ ...config, model: list[0] });
      }
    } catch (err: any) {
      alert("获取模型失败: " + err);
    } finally {
      setFetchingModels(false);
    }
  };

  const updateConfig = (newCfg: AgentConfig) => {
    setConfig(newCfg);
    localStorage.setItem("openminis_config", JSON.stringify(newCfg));
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
        content: "已开启新会话。随时输入文字、拖入文件或粘贴截图进行分析。"
      }
    ]);
    setCurrentSessionId(null);
    setInput("");
    setAttachments([]);
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || loading) return;
    if (!config.api_key) {
      setShowSettings(true);
      return;
    }

    const currentAttachments = [...attachments];
    setAttachments([]); // 清空输入栏待发附件

    // 1. 保存上传文件到沙箱并组装 Prompt 提示
    let promptText = input.trim();
    const uploadedImages: string[] = [];
    const uploadedFiles: { name: string; url: string }[] = [];

    for (const att of currentAttachments) {
      try {
        const minisUrl = await invoke<string>("upload_chat_attachment", {
          name: att.name,
          base64Data: att.dataUrl,
          isMedia: att.isMedia
        });

        if (att.isMedia) {
          uploadedImages.push(att.dataUrl);
          promptText += `\n\n[已就绪图片: ${minisUrl}]`;
        } else {
          uploadedFiles.push({ name: att.name, url: minisUrl });
          promptText += `\n\n[已就绪文件: ${minisUrl} (大小: ${att.sizeStr})，可直接读取或用 Python 处理]`;
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
    setStreamingText("");
    setActiveToolName(null);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      const updated = await invoke<ChatMessage[]>("run_agent_turn", {
        config,
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
      setStreamingText("");
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
        return { label: "file_write", icon: FileText, color: "text-[#32ADE6]", detail: `写入成功: ${parsed.path}` };
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
      className="flex h-screen w-screen bg-[#000000] text-[#FFFFFF] font-sans antialiased overflow-hidden select-none"
    >
      {/* 隐藏的文件上传 input */}
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
            <div className="flex items-center justify-between px-2 py-1 mb-3">
              <span className="text-xs font-semibold tracking-wider text-[#8E8E93] uppercase">Minis</span>
              <button
                onClick={handleNewChat}
                className="p-1.5 rounded-lg text-[#8E8E93] hover:text-[#FFFFFF] hover:bg-[#1C1C1E] transition"
                title="开启新对话"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="relative mb-3 px-1">
              <Search className="w-3.5 h-3.5 text-[#636366] absolute left-3.5 top-2.5" />
              <input
                type="text"
                value={sessionSearch}
                onChange={e => setSessionSearch(e.target.value)}
                placeholder="搜索历史会话..."
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

            {/* 底部原生功能按钮 */}
            <div className="border-t border-[#1C1C1E] pt-3 mt-2 space-y-1 px-1">
              <button
                onClick={() => invoke("open_sandbox_dir").catch(e => alert(e))}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#8E8E93] hover:bg-[#1C1C1E] hover:text-[#FFFFFF] transition"
              >
                <ExternalLink className="w-3.5 h-3.5" /> 浏览沙箱目录
              </button>

              <button
                onClick={() => invoke("launch_interactive_terminal").catch(e => alert(e))}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#8E8E93] hover:bg-[#1C1C1E] hover:text-[#FFFFFF] transition"
              >
                <Terminal className="w-3.5 h-3.5" /> 交互终端 (SSH)
              </button>

              <button
                onClick={() => {
                  invoke<string>("get_today_memory").then(t => setMemoryText(t)).catch(e => setMemoryText(e));
                  setShowMemoryModal(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#8E8E93] hover:bg-[#1C1C1E] hover:text-[#FFFFFF] transition"
              >
                <Brain className="w-3.5 h-3.5" /> 记忆系统
              </button>

              <button
                onClick={() => setShowSettings(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#8E8E93] hover:bg-[#1C1C1E] hover:text-[#FFFFFF] transition"
              >
                <SettingsIcon className="w-3.5 h-3.5" /> 偏好设置
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* ======================= 主工作区 ======================= */}
      <main className="flex-1 flex flex-col h-full bg-[#000000] relative">
        {/* 顶部极简导航栏 */}
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

          {/* 原版 Minis 核心：原生模型选择器胶囊 */}
          <div className="relative">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#1C1C1E] border border-[#2C2C2E] hover:border-[#3A3A3C] text-xs font-medium text-[#FFFFFF] transition shadow-sm"
            >
              <span className="truncate max-w-[180px]">{config.model || "选择模型"}</span>
              <ChevronDown className="w-3 h-3 text-[#8E8E93]" />
            </button>

            {/* 模型下拉菜单 */}
            {showModelPicker && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 w-64 bg-[#1C1C1E] border border-[#2C2C2E] rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#2C2C2E] mb-1">
                  <span className="text-[11px] font-semibold text-[#8E8E93]">可用模型</span>
                  <button
                    onClick={handleFetchModels}
                    disabled={fetchingModels}
                    className="text-[10px] text-[#0A84FF] hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${fetchingModels ? "animate-spin" : ""}`} /> 刷新
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-0.5">
                  {availableModels.length === 0 ? (
                    <div className="text-center py-4 text-xs text-[#636366]">
                      暂无模型，请点击刷新自动拉取
                    </div>
                  ) : (
                    availableModels.map(m => (
                      <button
                        key={m}
                        onClick={() => {
                          updateConfig({ ...config, model: m });
                          setShowModelPicker(false);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs truncate transition flex items-center justify-between ${
                          config.model === m ? "bg-[#0A84FF] text-white" : "text-[#D1D1D6] hover:bg-[#2C2C2E]"
                        }`}
                      >
                        <span className="truncate">{m}</span>
                        {config.model === m && <Check className="w-3 h-3" />}
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

        {/* 关键：未初始化沙箱时的极简优雅提示条 */}
        {!sandboxReady && (
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

        {/* ======================= 对话消息流 (1:1 原版排版) ======================= */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg, i) => {
              if (msg.role === "system") return null;

              // 工具调用结果展示：1:1 原版 Minis ToolCapsuleView
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

              // 用户消息：纯正 iOS 气泡 (右对齐，无头像，支持图片与文件缩略)
              if (msg.role === "user") {
                return (
                  <div key={i} className="flex flex-col items-end space-y-2">
                    {/* 用户附带的图片预览 */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end max-w-[80%]">
                        {msg.images.map((img, idx) => (
                          <img key={idx} src={img} alt="upload" className="max-h-56 max-w-sm rounded-xl border border-[#2C2C2E] object-cover" />
                        ))}
                      </div>
                    )}

                    {/* 用户附带的文件标签 */}
                    {msg.files && msg.files.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end max-w-[80%]">
                        {msg.files.map((f, idx) => (
                          <div key={idx} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1C1C1E] border border-[#2C2C2E] text-xs text-[#D1D1D6]">
                            <FileText className="w-3.5 h-3.5 text-[#32ADE6]" />
                            <span>{f.name}</span>
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

              // 助手消息：直接左对齐纯净文字排版 (无机器人头像！)
              return (
                <div key={i} className="flex flex-col space-y-2 text-[#E5E5EA] text-[15px] leading-relaxed select-text">
                  <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                </div>
              );
            })}

            {/* 流式打字机响应 */}
            {loading && streamingText && (
              <div className="flex flex-col space-y-2 text-[#E5E5EA] text-[15px] leading-relaxed select-text">
                <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingText}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* 工具正在调用中状态 */}
            {loading && activeToolName && (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#141416] border border-[#2C2C2E] text-[11px] text-[#8E8E93] animate-pulse">
                <Terminal className="w-3 h-3 text-[#34C759] animate-spin" />
                <span>{activeToolName}</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        {/* ======================= 原版 Minis 标志性胶囊输入栏 (支持附件与图片) ======================= */}
        <div className="p-4 shrink-0 bg-gradient-to-t from-[#000000] via-[#000000] to-transparent">
          <div className="max-w-3xl mx-auto bg-[#1C1C1E] border border-[#2C2C2E] rounded-[24px] px-3.5 py-2 flex flex-col gap-2 focus-within:border-[#3A3A3C] transition shadow-xl">
            
            {/* 上方附件暂存预览条 */}
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
                title="上传文件或图片 (也支持直接拖拽或 Ctrl+V 粘贴截图)"
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
                placeholder={attachments.length > 0 ? "输入对已选文件的要求..." : "发送消息、粘贴截图 (Ctrl+V) 或拖拽文件..."}
                className="flex-1 bg-transparent border-none text-sm text-[#FFFFFF] placeholder-[#636366] focus:outline-none resize-none max-h-40 py-1"
              />

              {/* 原版 Minis 经典圆钮发送键 (arrow.up.circle.fill 质感) */}
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

      {/* ======================= 可视化沙箱配置与排查中心 (绝不静默吞错误) ======================= */}
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

            {/* 动态进度条 */}
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

            {/* 执行日志流 */}
            <div className="bg-[#141416] border border-[#2C2C2E] rounded-xl p-3 h-44 overflow-y-auto font-mono text-[11px] text-[#A1A1A6] space-y-1">
              {initLogs.map((log, i) => (
                <div key={i} className="leading-relaxed">
                  {log}
                </div>
              ))}
            </div>

            {/* 错误提示与重试 */}
            {initError && (
              <div className="p-3 bg-[#FF453A]/10 border border-[#FF453A]/30 rounded-xl text-xs text-[#FF453A] space-y-2">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> 配置遇到问题
                </div>
                <div className="text-[11px] leading-relaxed text-[#FFD60A] font-mono whitespace-pre-wrap">
                  {initError}
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
              ) : initPercent === 100 ? (
                <button
                  onClick={() => setShowInitModal(false)}
                  className="px-5 py-1.5 rounded-full bg-[#34C759] hover:bg-[#30B753] text-xs font-semibold text-white transition flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" /> 沙箱已就绪，开始使用
                </button>
              ) : (
                <div className="text-xs text-[#8E8E93] flex items-center gap-2 py-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>全自动部署中，无需任何手工操作...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================= 设置模态框 (iOS 质感) ======================= */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1C1C1E] border border-[#2C2C2E] w-full max-w-md rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#2C2C2E]">
              <h2 className="text-sm font-semibold text-white">模型服务商配置</h2>
              <button onClick={() => setShowSettings(false)} className="text-[#8E8E93] hover:text-white text-xs">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[#8E8E93] mb-1">API Base URL</label>
                <input
                  type="text"
                  value={config.provider_url}
                  onChange={e => updateConfig({ ...config, provider_url: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full bg-[#141416] border border-[#2C2C2E] rounded-xl px-3 py-2 text-[#FFFFFF] focus:outline-none focus:border-[#0A84FF]"
                />
              </div>

              <div>
                <label className="block text-[#8E8E93] mb-1">API Key</label>
                <input
                  type="password"
                  value={config.api_key}
                  onChange={e => updateConfig({ ...config, api_key: e.target.value })}
                  placeholder="sk-..."
                  className="w-full bg-[#141416] border border-[#2C2C2E] rounded-xl px-3 py-2 text-[#FFFFFF] font-mono focus:outline-none focus:border-[#0A84FF]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[#8E8E93]">当前生效模型</label>
                  <button
                    onClick={handleFetchModels}
                    disabled={fetchingModels}
                    className="text-[#0A84FF] hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <RefreshCw className={`w-3 h-3 ${fetchingModels ? "animate-spin" : ""}`} /> 自动拉取列表
                  </button>
                </div>
                <input
                  type="text"
                  value={config.model}
                  onChange={e => updateConfig({ ...config, model: e.target.value })}
                  placeholder="gpt-4o, claude-3-5-sonnet..."
                  className="w-full bg-[#141416] border border-[#2C2C2E] rounded-xl px-3 py-2 text-[#FFFFFF] focus:outline-none focus:border-[#0A84FF]"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                className="bg-[#0A84FF] hover:bg-[#0071E3] text-white px-4 py-1.5 rounded-full text-xs font-medium transition"
              >
                完成
              </button>
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
