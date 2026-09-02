import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  Wrench 
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any;
  tool_call_id?: string;
}

interface AgentConfig {
  provider_url: string;
  api_key: string;
  model: string;
}

export default function App() {
  const [sandboxReady, setSandboxReady] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好！我是运行在 Windows 上的 OpenMinis 助手。\n\n> ⚠️ **备注：私人用极度不稳定 Aicoding 改**\n\n底层已连接 WSL2 Alpine 独立隔离沙箱，支持原生 `shell_execute`、文件读写与浏览器自动化。有什么可以帮你的？"
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [termCmd, setTermCmd] = useState("uname -a && cat /etc/alpine-release");
  const [termOutput, setTermOutput] = useState("");

  const [config, setConfig] = useState<AgentConfig>({
    provider_url: "https://api.openai.com/v1",
    api_key: "",
    model: "gpt-4o"
  });

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 检查沙箱状态
    invoke<boolean>("check_sandbox_status")
      .then(ready => setSandboxReady(ready))
      .catch(() => setSandboxReady(false));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = { role: "user", content: input };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setLoading(true);

    try {
      const updatedMessages = await invoke<ChatMessage[]>("run_agent_turn", {
        config,
        messages: nextHistory
      });
      setMessages(updatedMessages);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ 执行出错: ${err?.toString() || "未知异常"}`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleRunTerminalCmd = async () => {
    if (!termCmd.trim()) return;
    setTermOutput("正在沙箱中执行...\n");
    try {
      const res: any = await invoke("execute_sandbox_shell", {
        cmd: termCmd,
        timeoutSecs: 30
      });
      setTermOutput(`[Exit Code: ${res.exit_code}]\n\n--- STDOUT ---\n${res.stdout}\n\n--- STDERR ---\n${res.stderr}`);
    } catch (err: any) {
      setTermOutput(`执行失败: ${err}`);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#0f1117] text-slate-100 font-sans">
      {/* 侧边栏 */}
      <div className="w-64 border-r border-slate-800 bg-[#161822] flex flex-col justify-between p-4">
        <div>
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg">
              M
            </div>
            <div>
              <h1 className="font-semibold text-sm tracking-wide">OpenMinis</h1>
              <span className="text-[10px] text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">
                Win 试验版
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2">沙箱运行时</div>
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800 text-xs">
              <span className="flex items-center gap-2">
                <FolderGit2 className="w-4 h-4 text-slate-400" />
                WSL2 Alpine
              </span>
              {sandboxReady ? (
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 已就绪
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5" /> 未就绪
                </span>
              )}
            </div>

            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition ${
                showTerminal ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40" : "bg-slate-800/50 hover:bg-slate-800 text-slate-300"
              }`}
            >
              <Terminal className="w-4 h-4" />
              {showTerminal ? "收起沙箱终端" : "打开沙箱终端"}
            </button>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-4 text-[11px] text-slate-500 space-y-1">
          <div>私人用极度不稳定 Aicoding 改</div>
          <div>v1.13.0-windows-exp</div>
        </div>
      </div>

      {/* 主聊天区域 */}
      <div className="flex-1 flex flex-col bg-[#0f1117]">
        {/* 顶部标题栏 */}
        <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-[#13151f]">
          <div className="flex items-center gap-3">
            <Bot className="w-5 h-5 text-indigo-400" />
            <span className="text-sm font-medium">智能助理会话</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>模型: <strong className="text-slate-200">{config.model}</strong></span>
          </div>
        </div>

        {/* 消息流 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-3 max-w-3xl ${
                msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === "user"
                    ? "bg-slate-700 text-slate-200"
                    : msg.role === "tool"
                    ? "bg-amber-900/60 text-amber-300 border border-amber-700/50"
                    : "bg-indigo-600 text-white"
                }`}
              >
                {msg.role === "user" ? <User className="w-4 h-4" /> : msg.role === "tool" ? <Wrench className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white"
                    : msg.role === "tool"
                    ? "bg-slate-900 border border-slate-800 text-slate-300 font-mono text-xs overflow-x-auto w-full"
                    : "bg-[#181a24] text-slate-200 border border-slate-800/80"
                }`}
              >
                {msg.role === "tool" ? (
                  <pre className="whitespace-pre-wrap">{msg.content}</pre>
                ) : (
                  <div className="prose prose-invert max-w-none prose-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-indigo-400 animate-pulse">
              <Bot className="w-4 h-4" /> OpenMinis 正在调度沙箱工具与思考中...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 底部内嵌终端面板 */}
        {showTerminal && (
          <div className="h-64 border-t border-slate-800 bg-[#0a0c10] flex flex-col p-3 font-mono text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2 text-slate-400">
              <span className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5" /> WSL2 沙箱即时交互终端 (/bin/sh)
              </span>
              <button onClick={() => setShowTerminal(false)} className="hover:text-slate-200">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto bg-black/40 p-2 rounded text-emerald-400 whitespace-pre-wrap selection:bg-slate-700">
              {termOutput || "输入命令并点击运行，直连沙箱执行..."}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                value={termCmd}
                onChange={e => setTermCmd(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleRunTerminalCmd()}
                placeholder="输入沙箱命令，如 apk add curl, ls -la /var/minis..."
                className="flex-1 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={handleRunTerminalCmd}
                className="bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded text-white flex items-center gap-1"
              >
                <Play className="w-3 h-3" /> 执行
              </button>
            </div>
          </div>
        )}

        {/* 底部对话输入框 */}
        <div className="p-4 border-t border-slate-800 bg-[#13151f]">
          <div className="max-w-3xl mx-auto flex gap-2">
            <textarea
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="发送给 OpenMinis (如：帮我用 Python 统计下目录、查看系统信息)..."
              className="flex-1 bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 resize-none"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 rounded-xl flex items-center justify-center transition"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
