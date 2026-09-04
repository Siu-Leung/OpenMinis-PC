import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Plus,
  ChevronRight,
  Check,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  Server,
  CheckCircle2,
  AlertCircle,
  Sliders
} from "lucide-react";

export interface Provider {
  id: string;
  name: string; // 标签名称，例如: "Ds", "HT", "OpenAI"
  provider_type?: "openai" | "anthropic" | "gemini" | "xai" | "kimi" | "siliconflow" | "ollama" | "custom";
  provider_url: string;
  api_key: string;
  models: string[];
  auto_append_v1?: boolean;
  custom_user_agent?: string;
  api_format?: "chat" | "responses";
  is_azure?: boolean;
  image_generation?: "auto" | "images_api" | "chat";
  latency_ms?: number;
}

interface ProviderManagerProps {
  providers: Provider[];
  activeProviderId: string;
  activeModel: string;
  onSaveProviders: (providers: Provider[]) => void;
  onSetActiveProvider: (id: string) => void;
  onSetActiveModel: (model: string) => void;
  onClose: () => void;
}

interface ProviderPreset {
  id: string;
  name: string;
  type: Provider["provider_type"];
  provider_url: string;
  models: string[];
  requiresKey: boolean;
  hint: string;
  autoAppendV1?: boolean;
}

/**
 * 规范化服务商 API 地址（对标原版 effectiveBaseURL）：
 * 先 trim 空白 + trimEnd('/') 去掉尾斜杠，再判断是否追加 /v1。
 * 修复尾斜杠导致的 /v1//v1 重复追加 bug。
 */
function normalizeProviderUrl(rawUrl: string, autoAppendV1?: boolean): string {
  let base = (rawUrl || "").trim().replace(/\/+$/, "");
  if (base === "") return base;
  if (autoAppendV1 && !base.endsWith("/v1")) {
    base = `${base}/v1`;
  }
  return base;
}

const PRESETS: ProviderPreset[] = [
  {
    id: "preset-deepseek",
    name: "DeepSeek (深度求索)",
    type: "openai",
    provider_url: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
    requiresKey: true,
    hint: "推荐：官方 DeepSeek-V3 与 R1 深度思考推理模型",
    autoAppendV1: false,
  },
  {
    id: "preset-openai",
    name: "OpenAI",
    type: "openai",
    provider_url: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini", "o1"],
    requiresKey: true,
    hint: "官方 GPT-4o、o1/o3 推理模型",
    autoAppendV1: true,
  },
  {
    id: "preset-siliconflow",
    name: "SiliconFlow (硅基流动)",
    type: "siliconflow",
    provider_url: "https://api.siliconflow.cn/v1",
    models: [
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1",
      "Qwen/Qwen2.5-72B-Instruct",
      "internlm/internlm2_5-20b-chat"
    ],
    requiresKey: true,
    hint: "国内高速聚合，开箱即用，高性价比",
    autoAppendV1: true,
  },
  {
    id: "preset-ollama",
    name: "Ollama (本地私有)",
    type: "ollama",
    provider_url: "http://localhost:11434/v1",
    models: ["llama3.3:latest", "qwen2.5:latest", "deepseek-r1:latest"],
    requiresKey: false,
    hint: "完全离线、本地运行、无需 API Key",
    autoAppendV1: true,
  },
  {
    id: "preset-moonshot",
    name: "Moonshot (月之暗面 Kimi)",
    type: "kimi",
    provider_url: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    requiresKey: true,
    hint: "长文本与专业中文理解",
    autoAppendV1: true,
  },
  {
    id: "preset-anthropic",
    name: "Anthropic / Claude 兼容",
    type: "anthropic",
    provider_url: "https://api.anthropic.com/v1",
    models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
    requiresKey: true,
    hint: "业界顶级代码编写与逻辑分析能力",
    autoAppendV1: true,
  },
  {
    id: "preset-openrouter",
    name: "OpenRouter",
    type: "custom",
    provider_url: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "deepseek/deepseek-r1"],
    requiresKey: true,
    hint: "全球一站式模型聚合网关",
    autoAppendV1: true,
  },
  {
    id: "preset-custom",
    name: "自定义 OpenAI 兼容接口",
    type: "custom",
    provider_url: "https://api.example.com/v1",
    models: [],
    requiresKey: true,
    hint: "支持 OneAPI、NewAPI、Groq 等任意中转",
    autoAppendV1: false,
  }
];

export function ProviderManager({
  providers,
  activeProviderId,
  activeModel,
  onSaveProviders,
  onSetActiveProvider,
  onSetActiveModel,
  onClose,
}: ProviderManagerProps) {
  const [subView, setSubView] = useState<"list" | "choose_type" | "detail">("list");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  // 详情页表单状态
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isTestingLatency, setIsTestingLatency] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [newCustomModelInput, setNewCustomModelInput] = useState("");

  const openDetail = (p: Provider) => {
    setSelectedProviderId(p.id);
    setEditingProvider({
      ...p,
      auto_append_v1: p.auto_append_v1 ?? (p.provider_url.endsWith("/v1")),
      custom_user_agent: p.custom_user_agent || "",
      api_format: p.api_format || "chat",
      is_azure: p.is_azure ?? false,
      image_generation: p.image_generation || "auto",
    });
    setShowKey(false);
    setTestResult(null);
    setSubView("detail");
  };

  const handleSelectPreset = (preset: ProviderPreset) => {
    const newId = `${preset.type || "custom"}-${Date.now().toString(36)}`;
    const newP: Provider = {
      id: newId,
      name: preset.name.split(" ")[0],
      provider_type: preset.type,
      provider_url: preset.provider_url,
      api_key: "",
      models: [...preset.models],
      auto_append_v1: preset.autoAppendV1 ?? false,
      custom_user_agent: "",
      api_format: "chat",
      is_azure: false,
      image_generation: "auto",
    };

    const nextList = [...providers, newP];
    onSaveProviders(nextList);
    if (!activeProviderId) {
      onSetActiveProvider(newId);
      if (newP.models.length > 0) onSetActiveModel(newP.models[0]);
    }

    openDetail(newP);
  };

  const handleSaveDetail = () => {
    if (!editingProvider) return;
    const next = providers.map(p => p.id === editingProvider.id ? editingProvider : p);
    onSaveProviders(next);
    setSubView("list");
  };

  const handleDeleteProvider = (id: string) => {
    if (!confirm("确定要删除该 AI 服务商吗？删除后此服务商下的所有模型将无法继续调用。")) return;
    const next = providers.filter(p => p.id !== id);
    onSaveProviders(next);
    if (activeProviderId === id) {
      if (next.length > 0) {
        onSetActiveProvider(next[0].id);
        if (next[0].models.length > 0) onSetActiveModel(next[0].models[0]);
      } else {
        onSetActiveProvider("");
        onSetActiveModel("");
      }
    }
    setSubView("list");
  };

  const handleFetchModels = async () => {
    if (!editingProvider) return;
    setIsFetchingModels(true);
    setTestResult(null);

    let targetUrl = normalizeProviderUrl(editingProvider.provider_url, editingProvider.auto_append_v1);

    try {
      const models = await invoke<string[]>("fetch_provider_models", {
        providerUrl: targetUrl,
        apiKey: editingProvider.api_key || "",
      });

      if (models && models.length > 0) {
        const updated = { ...editingProvider, models };
        setEditingProvider(updated);
        const next = providers.map(p => p.id === updated.id ? updated : p);
        onSaveProviders(next);
        setTestResult({ ok: true, msg: `成功拉取并同步 ${models.length} 个可用模型！` });
      } else {
        setTestResult({ ok: false, msg: "服务商未返回任何模型，请确认 API Key 与地址。" });
      }
    } catch (err: any) {
      setTestResult({ ok: false, msg: `拉取失败: ${err}` });
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleTestLatency = async () => {
    if (!editingProvider) return;
    setIsTestingLatency(true);
    setTestResult(null);

    const start = Date.now();
    try {
      let targetUrl = normalizeProviderUrl(editingProvider.provider_url, editingProvider.auto_append_v1);

      await invoke<string[]>("fetch_provider_models", {
        providerUrl: targetUrl,
        apiKey: editingProvider.api_key || "",
      });
      const elapsed = Date.now() - start;
      const updated = { ...editingProvider, latency_ms: elapsed };
      setEditingProvider(updated);
      setTestResult({ ok: true, msg: `连接测试正常: 延迟 ${elapsed} ms (HTTP 200 OK)` });
    } catch (err: any) {
      setTestResult({ ok: false, msg: `连接测试失败: ${err}` });
    } finally {
      setIsTestingLatency(false);
    }
  };

  const handleAddCustomModel = () => {
    if (!editingProvider || !newCustomModelInput.trim()) return;
    const modelId = newCustomModelInput.trim();
    if (editingProvider.models.includes(modelId)) {
      alert("该模型已存在于列表中");
      return;
    }
    const updated = { ...editingProvider, models: [...editingProvider.models, modelId] };
    setEditingProvider(updated);
    setNewCustomModelInput("");
    const next = providers.map(p => p.id === updated.id ? updated : p);
    onSaveProviders(next);
  };

  const handleRemoveModel = (modelId: string) => {
    if (!editingProvider) return;
    const updated = { ...editingProvider, models: editingProvider.models.filter(m => m !== modelId) };
    setEditingProvider(updated);
    const next = providers.map(p => p.id === updated.id ? updated : p);
    onSaveProviders(next);
  };

  const maskKey = (key: string) => {
    if (!key || key.trim() === "") return "sk-未配置";
    if (key.length <= 10) return "sk-********";
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden select-none animate-in fade-in zoom-in-95 duration-150 font-sans">
        {/* =========================================================================
            视图 1: 供应商列表 (1:1 原版截图 df33a59dfc976cbe76528ce662d6fc7e_0dc58d.jpg)
        ========================================================================= */}
        {subView === "list" && (
          <>
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={onClose} className="p-1 rounded-lg text-black dark:text-white hover:opacity-80 transition">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">AI 服务商</h2>
              </div>
              <button
                onClick={() => setSubView("choose_type")}
                className="w-7 h-7 rounded-full bg-[#0A84FF] text-white flex items-center justify-center hover:opacity-90 transition shadow-sm"
                title="添加新服务商"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
              {providers.length === 0 ? (
                <div className="text-center py-14 px-4 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-[#2C2C2E]/30 flex items-center justify-center mx-auto text-[#8E8E93]">
                    <Server className="w-8 h-8" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-black dark:text-white">未配置任何 AI 服务商</div>
                    <div className="text-xs text-[#8E8E93] mt-1">添加您的 API Key 或本地模型，为 Minis 赋予推理能力</div>
                  </div>
                  <button
                    onClick={() => setSubView("choose_type")}
                    className="px-5 py-2.5 rounded-xl bg-[#0A84FF] text-white font-semibold shadow-md hover:opacity-90 transition"
                  >
                    添加 AI 服务商
                  </button>
                </div>
              ) : (
                <>
                  {/* OPENAI 分组 (1:1 原版质感) */}
                  <div>
                    <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider">
                      OPENAI
                    </div>
                    <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                      {providers.map(p => {
                        const isConfigured = p.api_key.trim().length > 0 || p.provider_url.includes("11434");
                        const isCurrentActive = p.id === activeProviderId;

                        return (
                          <div
                            key={p.id}
                            onClick={() => openDetail(p)}
                            className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition select-none"
                          >
                            <div className="flex items-center gap-3">
                              {/* 绿点 / 灰点状态指示灯 */}
                              <div
                                className={`w-2.5 h-2.5 rounded-full ${
                                  isConfigured ? "bg-[#34C759] shadow-[0_0_8px_#34C759]" : "bg-[#8E8E93]"
                                }`}
                              />
                              <div>
                                <div className="text-sm font-bold text-black dark:text-white flex items-center gap-2">
                                  <span>{p.name}</span>
                                  {isCurrentActive && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#0A84FF]/10 text-[#0A84FF] font-semibold">
                                      默认
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-[#8E8E93] flex items-center gap-1.5 mt-0.5">
                                  <span>API Key</span>
                                  <span>·</span>
                                  <span>{p.models.length} 个模型</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-[#8E8E93]">
                                {maskKey(p.api_key)}
                              </span>
                              <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 语音服务分组 (1:1 原版质感) */}
                  <div>
                    <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider">
                      语音服务
                    </div>
                    <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3.5 border border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#34C759] shadow-[0_0_8px_#34C759]" />
                        <div>
                          <div className="text-xs font-bold text-black dark:text-white">系统内置语音与音频服务</div>
                          <div className="text-[11px] text-[#8E8E93] mt-0.5">Edge TTS / Windows Media 音频合成就绪 (1 个语音转文字)</div>
                        </div>
                      </div>
                      <span className="text-xs font-mono text-[#8E8E93]">已激活</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* =========================================================================
            视图 2: 选择服务商类型 (主流推荐向导)
        ========================================================================= */}
        {subView === "choose_type" && (
          <>
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSubView("list")} className="p-1 rounded-lg text-black dark:text-white hover:opacity-80 transition">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">选择服务商类型</h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 text-xs">
              <div className="text-[11px] font-bold text-[#8E8E93] px-2 mb-2 uppercase tracking-wider">
                推荐主流服务商
              </div>

              {PRESETS.map(preset => (
                <div
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset)}
                  className="p-3.5 bg-white dark:bg-[#1C1C1E] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between cursor-pointer transition select-none shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#0A84FF]/10 text-[#0A84FF] flex items-center justify-center font-bold text-sm shrink-0">
                      {preset.name.slice(0, 1)}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-black dark:text-white">{preset.name}</div>
                      <div className="text-[11px] text-[#8E8E93] mt-0.5">{preset.hint}</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                </div>
              ))}
            </div>
          </>
        )}

        {/* =========================================================================
            视图 3: 供应商详情页面 (1:1 截图 49d44fb6cb59bb22f1d1ab703d7572e4_17c730.jpg)
        ========================================================================= */}
        {subView === "detail" && editingProvider && (
          <>
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSubView("list")} className="p-1 rounded-lg text-black dark:text-white hover:opacity-80 transition">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white truncate max-w-[240px]">
                  {editingProvider.name}
                </h2>
              </div>
              <button
                onClick={handleSaveDetail}
                className="px-4 py-1.5 rounded-xl bg-[#0A84FF] text-white text-xs font-semibold hover:opacity-90 shadow-sm transition"
              >
                完成
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {/* 卡片 1: 标签 (Label) */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider">
                  标签
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3 border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <input
                    type="text"
                    value={editingProvider.name}
                    onChange={e => setEditingProvider({ ...editingProvider, name: e.target.value })}
                    placeholder="服务商名称 (例如: Ds, HT, OpenAI)"
                    className="w-full bg-transparent border-none outline-none text-black dark:text-white font-semibold text-sm"
                  />
                </div>
              </div>

              {/* 卡片 2: API KEY */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider flex items-center justify-between">
                  <span>API KEY</span>
                  <span className="text-[10px] text-[#8E8E93] lowercase">粘贴后自动去除空格</span>
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3 border border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center gap-2">
                  <input
                    type={showKey ? "text" : "password"}
                    value={editingProvider.api_key}
                    onChange={e => setEditingProvider({ ...editingProvider, api_key: e.target.value.trim() })}
                    placeholder="sk-..."
                    className="flex-1 bg-transparent border-none outline-none text-black dark:text-white font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="p-1 text-[#8E8E93] hover:text-white transition"
                    title={showKey ? "隐藏密钥" : "显示密钥"}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* 卡片 3: 自定义 API 地址 (带 自动追加 /v1 和 保存 URL 设置) */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider">
                  自定义 API 地址
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <div className="p-3">
                    <input
                      type="text"
                      value={editingProvider.provider_url}
                      onChange={e => setEditingProvider({ ...editingProvider, provider_url: e.target.value.trim() })}
                      placeholder="https://api.deepseek.com"
                      className="w-full bg-transparent border-none outline-none text-black dark:text-white font-mono text-xs"
                    />
                  </div>
                  <div className="flex items-center justify-between p-3.5">
                    <div>
                      <div className="font-semibold text-black dark:text-white text-xs">自动追加 /v1</div>
                      <div className="text-[11px] text-[#8E8E93] mt-0.5">若服务商地址未包含 /v1 则请求时自动补齐</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={editingProvider.auto_append_v1}
                      onChange={e => setEditingProvider({ ...editingProvider, auto_append_v1: e.target.checked })}
                      className="w-4 h-4 accent-[#0A84FF]"
                    />
                  </div>
                  <div className="p-3">
                    <div className="text-[10px] font-semibold text-[#8E8E93] mb-1">自定义 USER-AGENT</div>
                    <input
                      type="text"
                      value={editingProvider.custom_user_agent}
                      onChange={e => setEditingProvider({ ...editingProvider, custom_user_agent: e.target.value })}
                      placeholder="留空使用默认值 (OpenMinis/1.13)"
                      className="w-full bg-transparent border-none outline-none text-black dark:text-white text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* 卡片 4: API FORMAT (Chat Completions / Responses API) */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider">
                  API FORMAT
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3 border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-2">
                  <div className="flex rounded-xl bg-[#F2F2F7] dark:bg-[#141416] p-1 border border-[#E5E5EA] dark:border-[#2C2C2E]">
                    <button
                      onClick={() => setEditingProvider({ ...editingProvider, api_format: "chat" })}
                      className={`flex-1 py-1.5 rounded-lg font-semibold transition ${
                        editingProvider.api_format === "chat"
                          ? "bg-[#0A84FF] text-white shadow-sm"
                          : "text-[#8E8E93] hover:text-white"
                      }`}
                    >
                      Chat Completions
                    </button>
                    <button
                      onClick={() => setEditingProvider({ ...editingProvider, api_format: "responses" })}
                      className={`flex-1 py-1.5 rounded-lg font-semibold transition ${
                        editingProvider.api_format === "responses"
                          ? "bg-[#0A84FF] text-white shadow-sm"
                          : "text-[#8E8E93] hover:text-white"
                      }`}
                    >
                      Responses API
                    </button>
                  </div>
                  <div className="text-[11px] text-[#8E8E93] leading-relaxed">
                    标准的 /v1/chat/completions 格式，兼容大多数 OpenAI 兼容服务与深度思考模型。
                  </div>
                </div>
              </div>

              {/* 卡片 5: AZURE OPENAI */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider">
                  AZURE OPENAI
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3.5 border border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-black dark:text-white text-xs">Azure OpenAI 认证</div>
                    <div className="text-[11px] text-[#8E8E93] mt-0.5">使用 api-key 标头替代 Bearer 令牌</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={editingProvider.is_azure}
                    onChange={e => setEditingProvider({ ...editingProvider, is_azure: e.target.checked })}
                    className="w-4 h-4 accent-[#0A84FF]"
                  />
                </div>
              </div>

              {/* 卡片 6: 状态与延迟测试 (STATUS) */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider">
                  状态
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3.5 border border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#34C759] shadow-[0_0_8px_#34C759]" />
                    <span className="font-semibold text-black dark:text-white text-xs">已启用 / 可用</span>
                    {editingProvider.latency_ms !== undefined && (
                      <span className="text-[11px] font-mono text-[#34C759] bg-[#34C759]/10 px-2 py-0.5 rounded-full font-bold">
                        {editingProvider.latency_ms} ms
                      </span>
                    )}
                  </div>

                  <button
                    onClick={handleTestLatency}
                    disabled={isTestingLatency}
                    className="px-3 py-1.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-black dark:text-white text-xs font-semibold hover:opacity-80 transition flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingLatency ? "animate-spin text-[#0A84FF]" : ""}`} />
                    <span>{isTestingLatency ? "测试中..." : "延迟测试"}</span>
                  </button>
                </div>
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-2xl text-xs flex items-center gap-2 ${
                    testResult.ok
                      ? "bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/30"
                      : "bg-[#FF453A]/10 text-[#FF453A] border border-[#FF453A]/30"
                  }`}
                >
                  {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  <span>{testResult.msg}</span>
                </div>
              )}

              {/* 卡片 7: 思考规则 (对标原版) */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider flex items-center justify-between">
                  <span>思考规则</span>
                  <span className="text-[10px] text-[#0A84FF] font-semibold">默认规则 (2)</span>
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3 border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-2">
                  <div className="text-[11px] text-[#8E8E93] leading-relaxed">
                    规则自上而下依次匹配，第一条匹配当前模型的规则决定发送哪些思考参数。内置默认规则会自动感知 deepseek-reasoner 与 r1 系列模型。
                  </div>
                </div>
              </div>

              {/* 卡片 8: 模型管理 (1:1 原版 Refresh model list + 标签 + 移除 + 自定义添加) */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider flex items-center justify-between">
                  <span>模型 ({editingProvider.models.length} 个)</span>
                  <button
                    onClick={handleFetchModels}
                    disabled={isFetchingModels}
                    className="text-[#0A84FF] hover:underline flex items-center gap-1 font-semibold"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isFetchingModels ? "animate-spin" : ""}`} />
                    <span>Refresh model list</span>
                  </button>
                </div>

                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden border border-[#E5E5EA] dark:border-[#2C2C2E] divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E]">
                  {editingProvider.models.length === 0 ? (
                    <div className="text-center py-6 text-xs text-[#8E8E93]">
                      暂无模型，请点击上方 Refresh model list 自动拉取
                    </div>
                  ) : (
                    editingProvider.models.map(m => {
                      const isVision = m.toLowerCase().includes("vision") || m.toLowerCase().includes("vl") || m.toLowerCase().includes("4o");
                      const isReasoner = m.toLowerCase().includes("reason") || m.toLowerCase().includes("r1") || m.toLowerCase().includes("o3") || m.toLowerCase().includes("o1");

                      return (
                        <div key={m} className="flex items-center justify-between p-3 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-black dark:text-white font-medium">{m}</span>
                            {isVision && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#32ADE6]/10 text-[#32ADE6] font-bold">
                                VISION
                              </span>
                            )}
                            {isReasoner && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#BF5AF2]/10 text-[#BF5AF2] font-bold">
                                REASONER
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleRemoveModel(m)}
                            className="p-1 text-[#8E8E93] hover:text-[#FF453A] transition"
                            title="从列表中移除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}

                  {/* 手动添加自定义模型 */}
                  <div className="p-3 bg-[#F2F2F7]/40 dark:bg-[#141416] flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="添加自定义模型 ID (如 deepseek-reasoner)"
                      value={newCustomModelInput}
                      onChange={e => setNewCustomModelInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleAddCustomModel();
                      }}
                      className="flex-1 bg-white dark:bg-[#1C1C1E] px-3 py-1.5 rounded-xl border border-[#E5E5EA] dark:border-[#2C2C2E] text-black dark:text-white text-xs outline-none font-mono"
                    />
                    <button
                      onClick={handleAddCustomModel}
                      className="px-3.5 py-1.5 rounded-xl bg-[#0A84FF] text-white font-semibold text-xs hover:opacity-90 transition shrink-0"
                    >
                      添加
                    </button>
                  </div>
                </div>
              </div>

              {/* 设为默认服务商 */}
              <button
                onClick={() => {
                  onSetActiveProvider(editingProvider.id);
                  if (editingProvider.models.length > 0) {
                    onSetActiveModel(editingProvider.models[0]);
                  }
                  alert(`已将 ${editingProvider.name} 设为当前活动服务商！`);
                }}
                className="w-full py-2.5 rounded-2xl bg-[#0A84FF]/10 text-[#0A84FF] font-semibold text-xs hover:bg-[#0A84FF]/20 transition"
              >
                设为当前默认服务商
              </button>

              {/* 删除按钮 */}
              <button
                onClick={() => handleDeleteProvider(editingProvider.id)}
                className="w-full py-2.5 rounded-2xl bg-[#FF453A]/10 text-[#FF453A] font-semibold text-xs hover:bg-[#FF453A]/20 transition flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>删除 AI 服务商</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
