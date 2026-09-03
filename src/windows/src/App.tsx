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
  Sparkles,
  Command
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_calls?: any;
  tool_call_id?: string;
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

interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  time: string;
  repeat: string;
  enabled: boolean;
  last_run: string | null;
  days: string[];
}

export default function App() {
  const [sandboxReady, setSandboxReady] = useState<boolean>(true);
  const [initializingSandbox, setInitializingSandbox] = useState<boolean>(false);
  const [initStatusText, setInitStatusText] = useState<string>("");

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好，我是 **Minis**。\n\n运行于独立的 Alpine Linux 沙箱环境，已集成浏览器自动化、持久化记忆与自动化运维工具链。有什么可以为你做的？"
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeToolName, setActiveToolName] = useState<string | null>(null);

  // 折叠状态记录 (针对各个工具输出块)
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({});
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // 顶部模型选择下拉菜单
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  // 设置对话框
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

  // 定时任务面板
  const [showTasksModal, setShowTasksModal] = useState(false);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskPrompt, setNewTaskPrompt] = useState("");
  const [newTaskTime, setNewTaskTime] = useState("09:00");

  // 记忆查看面板
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [memoryText, setMemoryText] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // 检测沙箱状态
    checkSandbox();

    // 自动加载模型缓存
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

    // 监听沙箱自动初始化进度
    const unlistenInit = listen<string>("sandbox-init-status", (event) => {
      setInitStatusText(event.payload);
      if (event.payload === "就绪") {
        setSandboxReady(true);
        setInitializingSandbox(false);
      }
    });

    // 监听定时任务触发
    const unlistenTask = listen<ScheduledTask>("scheduled-task-trigger", (event) => {
      const task = event.payload;
      setInput(task.prompt);
    });

    return () => {
      unlistenStream.then(un => un());
      unlistenInit.then(un => un());
      unlistenTask.then(un => un());
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, activeToolName]);

  const checkSandbox = async () => {
    try {
      const ready = await invoke<boolean>("check_sandbox_status");
      setSandboxReady(ready);
    } catch (_) {
      setSandboxReady(false);
    }
  };

  const handleAutoInitSandbox = async () => {
    setInitializingSandbox(true);
    setInitStatusText("正在启动全自动初始化流程...");
    try {
      await invoke("auto_initialize_sandbox");
      setSandboxReady(true);
    } catch (err: any) {
      alert("沙箱初始化遇到错误:\n" + (err?.toString() || "未知异常"));
    } finally {
      setInitializingSandbox(false);
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
        content: "已创建新对话。随时提出问题或下达指令。"
      }
    ]);
    setCurrentSessionId(null);
    setInput("");
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    if (!config.api_key) {
      setShowSettings(true);
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: input };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setLoading(true);
    setStreamingText("");
    setActiveToolName(null);

    // 重设输入框高度
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
    <div className="flex h-screen w-screen bg-[#000000] text-[#FFFFFF] font-sans antialiased overflow-hidden select-none">
      {/* ======================= 原版 Minis 极简侧边栏 ======================= */}
      {sidebarOpen && (
        <aside className="w-[260px] h-full bg-[#000000] border-r border-[#1C1C1E] flex flex-col justify-between p-3 shrink-0 z-20">
          <div className="flex flex-col h-full min-h-0">
            {/* 顶栏：新对话与关闭 */}
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

            {/* 搜索框 */}
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
              <span>
                {initializingSandbox
                  ? initStatusText || "正在全自动配置沙箱..."
                  : "WSL2 独立沙箱尚未安装或未完成配置"}
              </span>
            </div>
            <button
              onClick={handleAutoInitSandbox}
              disabled={initializingSandbox}
              className="bg-[#0A84FF] hover:bg-[#0071E3] disabled:opacity-50 text-white px-3.5 py-1 rounded-full font-medium transition shrink-0"
            >
              {initializingSandbox ? "配置中..." : "一键全自动配置沙箱"}
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

              // 用户消息：纯正 iOS 气泡 (右对齐，无头像)
              if (msg.role === "user") {
                return (
                  <div key={i} className="flex justify-end">
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

        {/* ======================= 原版 Minis 标志性胶囊输入栏 ======================= */}
        <div className="p-4 shrink-0 bg-gradient-to-t from-[#000000] via-[#000000] to-transparent">
          <div className="max-w-3xl mx-auto bg-[#1C1C1E] border border-[#2C2C2E] rounded-[24px] px-3.5 py-2 flex items-end gap-2 focus-within:border-[#3A3A3C] transition shadow-xl">
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
              placeholder="发送给 OpenMinis..."
              className="flex-1 bg-transparent border-none text-sm text-[#FFFFFF] placeholder-[#636366] focus:outline-none resize-none max-h-40 py-1"
            />

            {/* 原版 Minis 经典圆钮发送键 (arrow.up.circle.fill 质感) */}
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition shrink-0 ${
                input.trim() && !loading
                  ? "bg-[#FFFFFF] text-[#000000] hover:bg-[#E5E5EA]"
                  : "bg-[#2C2C2E] text-[#636366] cursor-not-allowed"
              }`}
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </main>

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
