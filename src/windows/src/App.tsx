import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Terminal,
  Settings,
  Send,
  Bot,
  User,
  CheckCircle2,
  AlertCircle,
  Play,
  FolderGit2,
  Wrench,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  ExternalLink,
  Power,
  History,
  Search,
  Clock,
  Brain,
  Trash2,
  Plus,
  Calendar,
  MessageSquare
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
  const [sandboxReady, setSandboxReady] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好！我是运行在 Windows 上的 **OpenMinis** 智能助理。\n\n> 🛡️ **安全审计状态：已彻底加固**\n> 宿主磁盘隔离已激活（禁止访问 `/mnt/c` 等宿主盘），命令注入防护已启用，WSL2 Alpine 独立沙箱已就绪。\n\n> 🧠 **记忆系统已激活**：我可以跨会话记住你的偏好，开始新任务前会自动检索过往记忆。\n\n你可以让我写代码、执行 Linux 脚本、处理文件或检索网页！"
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeToolStatus, setActiveToolStatus] = useState<string | null>(null);

  // 终端面板
  const [showTerminal, setShowTerminal] = useState(false);
  const [termCmd, setTermCmd] = useState("uname -a && cat /etc/os-release");
  const [termOutput, setTermOutput] = useState("");

  // 设置面板
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<AgentConfig>(() => {
    const saved = localStorage.getItem("openminis_config");
    return saved ? JSON.parse(saved) : {
      provider_url: "https://api.openai.com/v1",
      api_key: "",
      model: "gpt-4o"
    };
  });

  // 会话历史面板 (借鉴 Hermes cross-session recall)
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");

  // 定时任务面板 (借鉴 Hermes Cron 24/7)
  const [showTasks, setShowTasks] = useState(false);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskPrompt, setNewTaskPrompt] = useState("");
  const [newTaskTime, setNewTaskTime] = useState("09:00");
  const [newTaskRepeat, setNewTaskRepeat] = useState("daily");

  // 记忆面板 (借鉴 Hermes agent-curated memory)
  const [showMemory, setShowMemory] = useState(false);
  const [memoryContent, setMemoryContent] = useState("");
  const [memorySearchQuery, setMemorySearchQuery] = useState("");
  const [memorySearchResults, setMemorySearchResults] = useState<any[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<boolean>("check_sandbox_status")
      .then(ready => setSandboxReady(ready))
      .catch(() => setSandboxReady(false));

    const unlistenPromise = listen<StreamEvent>("agent-stream", (event) => {
      const payload = event.payload;
      if (payload.event_type === "token") {
        setStreamingText(prev => prev + payload.content);
      } else if (payload.event_type === "tool_start") {
        setActiveToolStatus(payload.content);
      } else if (payload.event_type === "tool_end") {
        setActiveToolStatus(null);
      }
    });

    return () => {
      unlistenPromise.then(un => un());
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, activeToolStatus]);

  // === 会话历史 ===
  const refreshSessions = async () => {
    try {
      const list = await invoke<SessionRecord[]>("list_sessions");
      setSessions(list);
    } catch (e) { console.error("加载会话失败:", e); }
  };

  const handleSearchSessions = async () => {
    if (!sessionSearchQuery.trim()) {
      refreshSessions();
      return;
    }
    try {
      const list = await invoke<SessionRecord[]>("search_sessions", { query: sessionSearchQuery });
      setSessions(list);
    } catch (e) { console.error("搜索会话失败:", e); }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await invoke("delete_session", { id });
      refreshSessions();
    } catch (e) { alert("删除失败: " + e); }
  };

  // === 定时任务 ===
  const refreshTasks = async () => {
    try {
      const list = await invoke<ScheduledTask[]>("list_tasks");
      setTasks(list);
    } catch (e) { console.error("加载任务失败:", e); }
  };

  const handleAddTask = async () => {
    if (!newTaskName.trim() || !newTaskPrompt.trim()) return;
    try {
      await invoke("add_task", {
        task: {
          id: Date.now().toString(36),
          name: newTaskName,
          prompt: newTaskPrompt,
          time: newTaskTime,
          repeat: newTaskRepeat,
          enabled: true,
          last_run: null,
          days: []
        }
      });
      setNewTaskName(""); setNewTaskPrompt("");
      refreshTasks();
    } catch (e) { alert("添加任务失败: " + e); }
  };

  const handleToggleTask = async (id: string) => {
    try { await invoke("toggle_task", { id }); refreshTasks(); }
    catch (e) { alert("切换失败: " + e); }
  };

  const handleRemoveTask = async (id: string) => {
    try { await invoke("remove_task", { id }); refreshTasks(); }
    catch (e) { alert("删除失败: " + e); }
  };

  // === 记忆系统 ===
  const refreshMemory = async () => {
    try {
      const content = await invoke<string>("get_today_memory");
      setMemoryContent(content || "今日暂无记忆记录。");
    } catch (e) { setMemoryContent("读取记忆失败: " + e); }
  };

  const handleSearchMemory = async () => {
    if (!memorySearchQuery.trim()) return;
    try {
      const results = await invoke<any[]>("search_memory", { query: memorySearchQuery });
      setMemorySearchResults(results);
    } catch (e) { console.error("搜索记忆失败:", e); }
  };

  const saveConfig = (newCfg: AgentConfig) => {
    setConfig(newCfg);
    localStorage.setItem("openminis_config", JSON.stringify(newCfg));
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    if (!config.api_key) { setShowSettings(true); return; }

    const userMsg: ChatMessage = { role: "user", content: input };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setLoading(true);
    setStreamingText("");
    setActiveToolStatus(null);

    try {
      const updatedMessages = await invoke<ChatMessage[]>("run_agent_turn", {
        config, messages: nextHistory
      });
      setMessages(updatedMessages);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `⚠️ 执行出错: ${err?.toString() || "未知异常"}` }
      ]);
    } finally {
      setLoading(false);
      setStreamingText("");
      setActiveToolStatus(null);
    }
  };

  const handleRunTerminalCmd = async () => {
    if (!termCmd.trim()) return;
    setTermOutput("正在沙箱中安全执行...\n");
    try {
      const res: any = await invoke("execute_sandbox_shell", { cmd: termCmd, timeoutSecs: 30 });
      setTermOutput(`[Exit Code: ${res.exit_code}]\n\n--- STDOUT ---\n${res.stdout}\n\n--- STDERR ---\n${res.stderr}`);
    } catch (err: any) { setTermOutput(`执行失败: ${err}`); }
  };

  const handleTerminateSandbox = async () => {
    try {
      await invoke("terminate_sandbox");
      setSandboxReady(false);
      alert("WSL2 沙箱实例已安全关闭，释放系统内存！下次执行命令时将自动冷启动。");
    } catch (e: any) { alert("关闭失败: " + e); }
  };

  const handleClearHistory = () => {
    if (confirm("确定要清空当前对话上下文吗？（历史会话已自动保存）")) {
      setMessages([{ role: "assistant", content: "已清空会话历史。请随时提出新要求！" }]);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#0d0f15] text-slate-100 font-sans">
      {/* 侧边栏 */}
      <div className="w-64 border-r border-slate-800/80 bg-[#13151f] flex flex-col justify-between p-4 shadow-xl">
        <div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center font-bold text-white shadow-indigo-500/20 shadow-lg">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-semibold text-sm tracking-wide text-white">OpenMinis</h1>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40 flex items-center gap-1 w-fit mt-0.5">
                <ShieldCheck className="w-3 h-3" /> 审计安全版
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">隔离沙箱状态</div>
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80 text-xs space-y-2 shadow-inner">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-300">
                  <FolderGit2 className="w-4 h-4 text-indigo-400" /> WSL2 Alpine
                </span>
                {sandboxReady ? (
                  <span className="flex items-center gap-1 text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 运行中
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-400 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" /> 未初始化
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 border-t border-slate-800/60 pt-2 flex items-center justify-between">
                <span>宿主隔离策略</span>
                <span className="text-emerald-400">/mnt/c 切断</span>
              </div>
            </div>

            {/* 智能能力区 (借鉴 Hermes + AionUi) */}
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1 pt-2">智能能力</div>

            <button
              onClick={() => { setShowSessions(!showSessions); if (!showSessions) refreshSessions(); }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                showSessions ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40" : "bg-slate-800/40 hover:bg-slate-800/80 text-slate-300 border border-slate-800/60"
              }`}
            >
              <History className="w-4 h-4 text-cyan-400" /> 会话历史检索
            </button>

            <button
              onClick={() => { setShowTasks(!showTasks); if (!showTasks) refreshTasks(); }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                showTasks ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40" : "bg-slate-800/40 hover:bg-slate-800/80 text-slate-300 border border-slate-800/60"
              }`}
            >
              <Clock className="w-4 h-4 text-amber-400" /> 定时自动化任务
            </button>

            <button
              onClick={() => { setShowMemory(!showMemory); if (!showMemory) refreshMemory(); }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                showMemory ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40" : "bg-slate-800/40 hover:bg-slate-800/80 text-slate-300 border border-slate-800/60"
              }`}
            >
              <Brain className="w-4 h-4 text-rose-400" /> 持久化记忆
            </button>

            {/* 工具区 */}
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1 pt-2">沙箱工具</div>

            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                showTerminal ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40" : "bg-slate-800/40 hover:bg-slate-800/80 text-slate-300 border border-slate-800/60"
              }`}
            >
              <Terminal className="w-4 h-4 text-indigo-400" /> {showTerminal ? "收起沙箱终端" : "打开沙箱终端"}
            </button>

            <button
              onClick={() => invoke("launch_interactive_terminal").catch(e => alert("唤起终端失败: " + e))}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium bg-slate-800/40 hover:bg-slate-800/80 text-slate-300 border border-slate-800/60 transition"
              title="唤起 Windows 原生交互式终端 (支持输入 SSH 密码、Vim、Htop)"
            >
              <Terminal className="w-4 h-4 text-violet-400" /> 唤起独立终端 (SSH/交互)
            </button>

            <button
              onClick={() => invoke("open_sandbox_dir").catch(e => alert("打开目录失败: " + e))}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium bg-slate-800/40 hover:bg-slate-800/80 text-slate-300 border border-slate-800/60 transition"
            >
              <ExternalLink className="w-4 h-4 text-emerald-400" /> 浏览沙箱文件
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium bg-slate-800/40 hover:bg-slate-800/80 text-slate-300 border border-slate-800/60 transition"
            >
              <Settings className="w-4 h-4 text-slate-400" /> 模型与接口设置
            </button>
          </div>
        </div>

        <div className="border-t border-slate-800/80 pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <button onClick={handleClearHistory} title="清空会话" className="text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1.5 transition">
              <RotateCcw className="w-3.5 h-3.5" /> 清空对话
            </button>
            <button onClick={handleTerminateSandbox} title="终止沙箱释放内存" className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1.5 transition">
              <Power className="w-3.5 h-3.5" /> 释放内存
            </button>
          </div>
          <div className="text-[10px] text-slate-500">
            <div>私人用极度不稳定 Aicoding 改</div>
            <div>v1.13.0-windows-hardened</div>
          </div>
        </div>
      </div>

      {/* 主工作区 */}
      <div className="flex-1 flex flex-col bg-[#0d0f15]">
        {/* 顶部栏 */}
        <div className="h-14 border-b border-slate-800/80 flex items-center justify-between px-6 bg-[#12141e]/80 backdrop-blur">
          <div className="flex items-center gap-3">
            <Bot className="w-5 h-5 text-indigo-400" />
            <span className="text-sm font-semibold tracking-wide text-slate-200">智能会话流</span>
            {activeToolStatus && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5 animate-pulse">
                <Wrench className="w-3.5 h-3.5 animate-spin" /> {activeToolStatus}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>当前模型: <strong className="text-indigo-300 font-mono">{config.model}</strong></span>
          </div>
        </div>

        {/* 消息流 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 max-w-3xl ${msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-md ${
                msg.role === "user" ? "bg-slate-700 text-slate-200"
                : msg.role === "tool" ? "bg-amber-950/80 text-amber-300 border border-amber-700/60"
                : "bg-indigo-600 text-white"
              }`}>
                {msg.role === "user" ? <User className="w-4 h-4" /> : msg.role === "tool" ? <Wrench className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                msg.role === "user" ? "bg-indigo-600 text-white"
                : msg.role === "tool" ? "bg-slate-950/90 border border-slate-800 text-slate-300 font-mono text-xs overflow-x-auto w-full"
                : "bg-[#161924] text-slate-200 border border-slate-800/80"
              }`}>
                {msg.role === "tool" ? (
                  <div>
                    <div className="text-[11px] text-amber-400 font-semibold mb-1 flex items-center gap-1">
                      <Wrench className="w-3 h-3" /> 工具执行输出
                    </div>
                    <pre className="whitespace-pre-wrap selection:bg-slate-700">{msg.content}</pre>
                  </div>
                ) : (
                  <div className="prose prose-invert max-w-none prose-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && streamingText && (
            <div className="flex gap-3 max-w-3xl mr-auto">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md animate-pulse">
                <Bot className="w-4 h-4" />
              </div>
              <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-[#161924] text-slate-200 border border-indigo-500/40 shadow-indigo-500/10 shadow-lg">
                <div className="prose prose-invert max-w-none prose-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {loading && !streamingText && (
            <div className="flex items-center gap-2 text-xs text-indigo-400 animate-pulse pl-11">
              <Bot className="w-4 h-4" /> OpenMinis 正在分析并调度沙箱工具...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 会话历史侧抽屉 (借鉴 Hermes cross-session recall) */}
        {showSessions && (
          <div className="h-72 border-t border-slate-800 bg-[#08090d] flex flex-col p-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2 text-slate-400">
              <span className="flex items-center gap-2 text-cyan-300">
                <History className="w-3.5 h-3.5" /> 历史会话检索 (跨会话回忆)
              </span>
              <button onClick={() => setShowSessions(false)} className="hover:text-slate-200">✕</button>
            </div>
            <div className="flex gap-2 mb-2">
              <input
                value={sessionSearchQuery}
                onChange={e => setSessionSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearchSessions()}
                placeholder="按关键词搜索历史会话..."
                className="flex-1 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
              />
              <button onClick={handleSearchSessions} className="bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 rounded text-white flex items-center gap-1">
                <Search className="w-3 h-3" /> 搜索
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {sessions.length === 0 ? (
                <div className="text-slate-500 text-center py-4">暂无历史会话记录</div>
              ) : sessions.map(s => (
                <div key={s.id} className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60 flex items-center justify-between hover:border-slate-700">
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-200 font-medium truncate">{s.title}</div>
                    <div className="text-[10px] text-slate-500 flex items-center gap-2">
                      <span>{s.created_at}</span><span>·</span><span>{s.message_count} 条消息</span>
                    </div>
                    <div className="text-[10px] text-slate-600 truncate mt-0.5">{s.preview}</div>
                  </div>
                  <button onClick={() => handleDeleteSession(s.id)} className="text-slate-600 hover:text-rose-400 p-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 定时任务面板 (借鉴 Hermes Cron 24/7) */}
        {showTasks && (
          <div className="h-72 border-t border-slate-800 bg-[#08090d] flex flex-col p-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2 text-slate-400">
              <span className="flex items-center gap-2 text-amber-300">
                <Clock className="w-3.5 h-3.5" /> 定时自动化任务 (Cron 24/7)
              </span>
              <button onClick={() => setShowTasks(false)} className="hover:text-slate-200">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 mb-2">
              {tasks.length === 0 ? (
                <div className="text-slate-500 text-center py-4">暂无定时任务，在下方添加</div>
              ) : tasks.map(t => (
                <div key={t.id} className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${t.enabled ? "bg-emerald-400" : "bg-slate-600"}`} />
                      <span className="text-slate-200 font-medium">{t.name}</span>
                      <span className="text-[10px] text-amber-400 font-mono">{t.time}</span>
                      <span className="text-[10px] text-slate-500">{t.repeat}</span>
                    </div>
                    <div className="text-[10px] text-slate-600 truncate mt-0.5">{t.prompt}</div>
                    {t.last_run && <div className="text-[9px] text-slate-700 mt-0.5">上次运行: {t.last_run}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleToggleTask(t.id)} className={`text-[10px] px-2 py-0.5 rounded ${t.enabled ? "bg-emerald-900/60 text-emerald-300" : "bg-slate-800 text-slate-500"}`}>
                      {t.enabled ? "已启用" : "已禁用"}
                    </button>
                    <button onClick={() => handleRemoveTask(t.id)} className="text-slate-600 hover:text-rose-400 p-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-800 pt-2 space-y-1.5">
              <input value={newTaskName} onChange={e => setNewTaskName(e.target.value)} placeholder="任务名称 (如: 每日新闻摘要)"
                className="w-full bg-slate-900 border border-slate-800 px-3 py-1.5 rounded text-slate-200 focus:outline-none focus:border-amber-500" />
              <input value={newTaskPrompt} onChange={e => setNewTaskPrompt(e.target.value)} placeholder="Agent 执行指令 (如: 帮我搜索今日科技新闻并总结)"
                className="w-full bg-slate-900 border border-slate-800 px-3 py-1.5 rounded text-slate-200 focus:outline-none focus:border-amber-500" />
              <div className="flex gap-2">
                <input type="time" value={newTaskTime} onChange={e => setNewTaskTime(e.target.value)} className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded text-slate-200 focus:outline-none focus:border-amber-500" />
                <select value={newTaskRepeat} onChange={e => setNewTaskRepeat(e.target.value)} className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded text-slate-200 focus:outline-none focus:border-amber-500">
                  <option value="once">仅一次</option>
                  <option value="daily">每天</option>
                  <option value="weekdays">工作日</option>
                  <option value="custom">自定义</option>
                </select>
                <button onClick={handleAddTask} className="bg-amber-600 hover:bg-amber-500 px-4 py-1.5 rounded text-white flex items-center gap-1 font-medium">
                  <Plus className="w-3 h-3" /> 添加
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 记忆面板 (借鉴 Hermes agent-curated memory) */}
        {showMemory && (
          <div className="h-72 border-t border-slate-800 bg-[#08090d] flex flex-col p-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2 text-slate-400">
              <span className="flex items-center gap-2 text-rose-300">
                <Brain className="w-3.5 h-3.5" /> 持久化记忆 (跨会话学习)
              </span>
              <button onClick={() => setShowMemory(false)} className="hover:text-slate-200">✕</button>
            </div>
            <div className="flex gap-2 mb-2">
              <input value={memorySearchQuery} onChange={e => setMemorySearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearchMemory()}
                placeholder="按关键词检索记忆..."
                className="flex-1 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded text-slate-200 focus:outline-none focus:border-rose-500" />
              <button onClick={handleSearchMemory} className="bg-rose-600 hover:bg-rose-500 px-3 py-1.5 rounded text-white flex items-center gap-1">
                <Search className="w-3 h-3" /> 检索
              </button>
            </div>
            {memorySearchResults.length > 0 && (
              <div className="mb-2 space-y-1 max-h-24 overflow-y-auto">
                {memorySearchResults.map((r, i) => (
                  <div key={i} className="p-1.5 rounded bg-rose-950/30 border border-rose-900/40 text-slate-400 text-[10px]">
                    {r.content || JSON.stringify(r).slice(0, 200)}
                  </div>
                ))}
              </div>
            )}
            <div className="flex-1 overflow-y-auto bg-black/60 p-2.5 rounded text-rose-300/80 whitespace-pre-wrap selection:bg-slate-700">
              {memoryContent || "点击刷新加载今日记忆..."}
            </div>
            <button onClick={refreshMemory} className="mt-2 text-[10px] text-slate-500 hover:text-rose-400 flex items-center gap-1">
              <RotateCcw className="w-3 h-3" /> 刷新记忆
            </button>
          </div>
        )}

        {/* 内嵌终端 */}
        {showTerminal && (
          <div className="h-64 border-t border-slate-800 bg-[#08090d] flex flex-col p-3 font-mono text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2 text-slate-400">
              <span className="flex items-center gap-2 text-indigo-300">
                <Terminal className="w-3.5 h-3.5" /> WSL2 沙箱即时终端 (/bin/sh - 宿主盘已断开)
              </span>
              <button onClick={() => setShowTerminal(false)} className="hover:text-slate-200">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto bg-black/60 p-2.5 rounded text-emerald-400 whitespace-pre-wrap selection:bg-slate-700">
              {termOutput || "输入命令并点击执行，直连沙箱运行 (如 apk add python3, curl -s ip.sb)..."}
            </div>
            <div className="flex gap-2 mt-2">
              <input value={termCmd} onChange={e => setTermCmd(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleRunTerminalCmd()}
                placeholder="输入命令..."
                className="flex-1 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded text-slate-200 focus:outline-none focus:border-indigo-500" />
              <button onClick={handleRunTerminalCmd} className="bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 rounded text-white flex items-center gap-1 text-xs font-medium">
                <Play className="w-3 h-3" /> 执行
              </button>
            </div>
          </div>
        )}

        {/* 底部输入框 */}
        <div className="p-4 border-t border-slate-800/80 bg-[#12141e]">
          <div className="max-w-3xl mx-auto flex gap-2">
            <textarea rows={1} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={config.api_key ? "发送给 OpenMinis (如：帮我用 Python 下载并分析数据)..." : "请先在左侧设置中填入 API Key 后即可开始对话..."}
              className="flex-1 bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 resize-none shadow-inner" />
            <button onClick={handleSend} disabled={loading || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 rounded-xl flex items-center justify-center transition shadow-lg shadow-indigo-600/20">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 设置弹窗 */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#161824] border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-indigo-400" /> 模型与连接设置
              </h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-200 text-sm">✕</button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">API Base URL</label>
                <input type="text" value={config.provider_url} onChange={e => saveConfig({ ...config, provider_url: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">API Key</label>
                <input type="password" value={config.api_key} onChange={e => saveConfig({ ...config, api_key: e.target.value })}
                  placeholder="sk-..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 font-mono" />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Model Name</label>
                <input type="text" value={config.model} onChange={e => saveConfig({ ...config, model: e.target.value })}
                  placeholder="gpt-4o, claude-3-5-sonnet-20241022, deepseek-chat..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button onClick={() => setShowSettings(false)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/20">
                保存并关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
