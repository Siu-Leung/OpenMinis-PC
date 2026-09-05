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
  Key,
  Globe,
  Sliders,
  Sparkles,
  Zap,
  Activity,
  Layers
} from "lucide-react";

export interface Provider {
  id: string;
  name: string; // 标签名称，例如: "AU", "DeepSeek", "OpenAI"
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
    name: "DeepSeek",
    type: "openai",
    provider_url: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
    requiresKey: true,
    hint: "官方 DeepSeek-V3 与 R1 深度推理模型",
    autoAppendV1: false,
  },
  {
    id: "preset-openai",
    name: "OpenAI",
    type: "openai",
    provider_url: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini", "o1"],
    requiresKey: true,
    hint: "官方 GPT-4o 与 o1/o3 推理旗舰",
    autoAppendV1: true,
  },
  {
    id: "preset-anthropic",
    name: "Anthropic / Claude",
    type: "anthropic",
    provider_url: "https://api.anthropic.com/v1",
    models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
    requiresKey: true,
    hint: "顶级代码工程能力与高难度逻辑思考",
    autoAppendV1: true,
  },
  {
    id: "preset-siliconflow",
    name: "SiliconFlow (硅基流动)",
    type: "siliconflow",
    provider_url: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-72B-Instruct"],
    requiresKey: true,
    hint: "国内高速中转聚合，开箱即用",
    autoAppendV1: true,
  },
  {
    id: "preset-ollama",
    name: "Ollama (本地私有)",
    type: "ollama",
    provider_url: "http://localhost:11434/v1",
    models: ["llama3.3:latest", "qwen2.5:latest", "deepseek-r1:latest"],
    requiresKey: false,
    hint: "完全离线、本地运行、无需 API 密钥",
    autoAppendV1: true,
  },
  {
    id: "preset-custom",
    name: "自定义 / 中转网关 (OneAPI/NewAPI)",
    type: "custom",
    provider_url: "https://api.example.com/v1",
    models: [],
    requiresKey: true,
    hint: "支持任何 OpenAI 兼容的第三方中转",
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
  const [subView, setSubView] = useState<"list" | "choose_preset" | "detail">("list");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  // 详情页表单状态
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [modelTestResults, setModelTestResults] = useState<{ [model: string]: { ok: boolean; ms: number; err?: string } }>({});
  const [newCustomModelInput, setNewCustomModelInput] = useState("");

  const openDetail = (p: Provider) => {
    setSelectedProviderId(p.id);
    setEditingProvider({
      ...p,
      auto_append_v1: p.auto_append_v1 ?? true,
    });
    setShowKey(false);
    setModelTestResults({});
    setSubView("detail");
  };

  const handleSelectPreset = (preset: ProviderPreset) => {
    const newId = "p_" + Date.now().toString(36);
    const newProvider: Provider = {
      id: newId,
      name: preset.name.split(" ")[0],
      provider_type: preset.type,
      provider_url: preset.provider_url,
      api_key: "",
      models: [...preset.models],
      auto_append_v1: preset.autoAppendV1 ?? false,
    };
    const next = [...providers, newProvider];
    onSaveProviders(next);
    openDetail(newProvider);
  };

  const handleFetchModels = async () => {
    if (!editingProvider) return;
    setIsFetchingModels(true);
    let targetUrl = normalizeProviderUrl(editingProvider.provider_url, editingProvider.auto_append_v1);

    try {
      const fetched = await invoke<string[]>("fetch_provider_models", {
        providerUrl: targetUrl,
        apiKey: editingProvider.api_key || "",
      });

      if (fetched && fetched.length > 0) {
        // 合并去重
        const combined = Array.from(new Set([...editingProvider.models, ...fetched]));
        const updated = { ...editingProvider, models: combined };
        setEditingProvider(updated);
        const next = providers.map(p => p.id === updated.id ? updated : p);
        onSaveProviders(next);
        alert(`已成功同步并发现 ${fetched.length} 个可用模型！`);
      } else {
        alert("服务商未返回任何模型，请检查 API 地址与密钥。");
      }
    } catch (err: any) {
      alert(`拉取模型失败: ${err}`);
    } finally {
      setIsFetchingModels(false);
    }
  };

  // 单模型严谨 Ping 测试 (对齐 Android 版，绝不虚报未验证的图文标签)
  const handleTestSingleModel = async (modelId: string) => {
    if (!editingProvider) return;
    setTestingModelId(modelId);
    const start = Date.now();
    try {
      let targetUrl = normalizeProviderUrl(editingProvider.provider_url, editingProvider.auto_append_v1);
      const res = await invoke<{ supports_text: boolean; supports_vision: boolean; latency_ms: number; error?: string }>(
        "test_model_multimodal",
        {
          providerUrl: targetUrl,
          apiKey: editingProvider.api_key || "",
          model: modelId,
        }
      );
      const elapsed = res.latency_ms || (Date.now() - start);
      setModelTestResults(prev => ({
        ...prev,
        [modelId]: {
          ok: res.supports_text,
          ms: elapsed,
          err: res.error,
        }
      }));
    } catch (e: any) {
      setModelTestResults(prev => ({
        ...prev,
        [modelId]: {
          ok: false,
          ms: 0,
          err: String(e),
        }
      }));
    } finally {
      setTestingModelId(null);
    }
  };

  const handleAddCustomModel = () => {
    if (!editingProvider || !newCustomModelInput.trim()) return;
    const modelId = newCustomModelInput.trim();
    if (editingProvider.models.includes(modelId)) {
      alert("该模型已存在");
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
    if (!key || key.trim() === "") return "未配置密钥 (sk-...)";
    if (key.length <= 10) return "sk-********";
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 font-sans select-none animate-in fade-in duration-150">
      <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-black dark:text-white">

        {/* ─── 视图 1: 供应商列表 (1:1 原版 ProviderListScreen 规范) ─── */}
        {subView === "list" && (
          <>
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={onClose} className="p-1 rounded-lg text-black dark:text-white hover:opacity-80 transition">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">AI 提供商</h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#0A84FF]/10 text-[#0A84FF] font-semibold">
                    {providers.length} 个实例
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSubView("choose_preset")}
                className="p-1.5 rounded-xl bg-[#0A84FF] text-white hover:bg-[#0A84FF]/90 transition shadow-sm"
                title="添加提供商"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {providers.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-black/5 dark:bg-white/5 flex items-center justify-center mx-auto text-[#8E8E93]">
                    <Key className="w-6 h-6" />
                  </div>
                  <div className="font-bold text-sm">暂未配置任何提供商</div>
                  <div className="text-[11px] text-[#8E8E93] max-w-xs mx-auto">
                    点击右上角“+”号，从预置列表或自定义中添加一个 AI 模型供应商以开始使用。
                  </div>
                </div>
              ) : (
                providers.map(p => {
                  const isCurrentActive = p.id === activeProviderId;
                  return (
                    <div
                      key={p.id}
                      onClick={() => openDetail(p)}
                      className={`p-4 rounded-2xl border transition cursor-pointer flex items-center justify-between shadow-sm ${
                        isCurrentActive
                          ? "bg-white dark:bg-[#1C1C1E] border-[#0A84FF] ring-1 ring-[#0A84FF]/30"
                          : "bg-white dark:bg-[#1C1C1E] border-[#E5E5EA] dark:border-[#2C2C2E] hover:border-[#0A84FF]/40"
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0 pr-2">
                        <div className="w-10 h-10 rounded-xl bg-[#0A84FF]/10 text-[#0A84FF] flex items-center justify-center font-bold text-sm shrink-0">
                          {p.name ? p.name.slice(0, 2).toUpperCase() : "AI"}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm truncate">{p.name}</span>
                            {isCurrentActive && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#34C759]/15 text-[#34C759]">
                                当前选中
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-[#8E8E93] truncate mt-0.5">
                            {p.provider_url}
                          </div>
                          <div className="text-[10px] text-[#8E8E93] mt-0.5">
                            包含 {p.models.length} 个模型 · {maskKey(p.api_key)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <ChevronRight className="w-4 h-4 text-[#8E8E93]" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ─── 视图 2: 预置服务商选择 (1:1 Android AddProviderScreen) ─── */}
        {subView === "choose_preset" && (
          <>
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSubView("list")} className="p-1 rounded-lg text-black dark:text-white hover:opacity-80 transition">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold">选择提供商类型</h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 text-xs">
              {PRESETS.map(preset => (
                <div
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset)}
                  className="p-3.5 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] hover:border-[#0A84FF] cursor-pointer transition flex items-center justify-between shadow-sm"
                >
                  <div>
                    <div className="font-bold text-sm">{preset.name}</div>
                    <div className="text-[11px] text-[#8E8E93] mt-0.5">{preset.hint}</div>
                    <div className="text-[10px] font-mono text-[#0A84FF] mt-0.5">{preset.provider_url}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#8E8E93] shrink-0" />
                </div>
              ))}
            </div>
          </>
        )}

        {/* ─── 视图 3: 供应商详情与模型管理 (1:1 Android ProviderDetailScreen) ─── */}
        {subView === "detail" && editingProvider && (
          <>
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button onClick={() => setSubView("list")} className="p-1 rounded-lg text-black dark:text-white hover:opacity-80 transition">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold truncate max-w-xs">{editingProvider.name} 配置</h2>
              </div>
              <button
                onClick={() => {
                  if (confirm(`确定删除提供商 ${editingProvider.name} 吗？`)) {
                    const next = providers.filter(p => p.id !== editingProvider.id);
                    onSaveProviders(next);
                    if (activeProviderId === editingProvider.id && next.length > 0) {
                      onSetActiveProvider(next[0].id);
                      if (next[0].models.length > 0) onSetActiveModel(next[0].models[0]);
                    }
                    setSubView("list");
                  }
                }}
                className="p-1.5 text-[#FF453A] hover:bg-[#FF453A]/10 rounded-xl transition"
                title="删除该提供商"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {/* 卡片 1: 基础连接信息 */}
              <div className="p-4 bg-white dark:bg-[#1C1C1E] rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-3 shadow-sm">
                <div className="font-bold text-xs text-[#8E8E93] uppercase tracking-wider">连接参数</div>

                <div>
                  <label className="block text-[#8E8E93] mb-1">标签名称 (显示于顶栏)</label>
                  <input
                    type="text"
                    value={editingProvider.name}
                    onChange={e => {
                      const updated = { ...editingProvider, name: e.target.value };
                      setEditingProvider(updated);
                      onSaveProviders(providers.map(p => p.id === updated.id ? updated : p));
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] outline-none font-medium"
                  />
                </div>

                <div>
                  <label className="block text-[#8E8E93] mb-1">API 端点地址 (Base URL)</label>
                  <input
                    type="text"
                    value={editingProvider.provider_url}
                    onChange={e => {
                      const updated = { ...editingProvider, provider_url: e.target.value };
                      setEditingProvider(updated);
                      onSaveProviders(providers.map(p => p.id === updated.id ? updated : p));
                    }}
                    placeholder="https://api.openai.com/v1"
                    className="w-full px-3 py-2 rounded-xl bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] outline-none font-mono"
                  />
                  <div className="flex items-center justify-between mt-1.5 px-1">
                    <span className="text-[11px] text-[#8E8E93]">自动确保结尾包含 /v1 路径</span>
                    <input
                      type="checkbox"
                      checked={editingProvider.auto_append_v1}
                      onChange={e => {
                        const updated = { ...editingProvider, auto_append_v1: e.target.checked };
                        setEditingProvider(updated);
                        onSaveProviders(providers.map(p => p.id === updated.id ? updated : p));
                      }}
                      className="w-4 h-4 accent-[#0A84FF]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[#8E8E93] mb-1">API Key 密钥</label>
                  <div className="flex items-center gap-2">
                    <input
                      type={showKey ? "text" : "password"}
                      value={editingProvider.api_key}
                      onChange={e => {
                        const updated = { ...editingProvider, api_key: e.target.value };
                        setEditingProvider(updated);
                        onSaveProviders(providers.map(p => p.id === updated.id ? updated : p));
                      }}
                      placeholder="sk-..."
                      className="flex-1 px-3 py-2 rounded-xl bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] outline-none font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="p-2 rounded-xl bg-[#F2F2F7] dark:bg-[#141416] text-[#8E8E93] hover:text-black dark:hover:text-white"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* 卡片 2: 模型库与独立开关 (1:1 对标 Android Model Toggles) */}
              <div className="p-4 bg-white dark:bg-[#1C1C1E] rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-xs text-[#8E8E93] uppercase tracking-wider">
                    可用模型列表 ({editingProvider.models.length})
                  </div>
                  <button
                    onClick={handleFetchModels}
                    disabled={isFetchingModels}
                    className="px-2.5 py-1 rounded-lg bg-[#0A84FF]/10 text-[#0A84FF] text-xs font-semibold hover:bg-[#0A84FF]/20 transition flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isFetchingModels ? "animate-spin" : ""}`} />
                    <span>从 API 自动拉取</span>
                  </button>
                </div>

                {/* 添加自定义模型 */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="输入模型 ID (如 gpt-4.5-preview)"
                    value={newCustomModelInput}
                    onChange={e => setNewCustomModelInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleAddCustomModel()}
                    className="flex-1 px-3 py-1.5 rounded-xl bg-[#F2F2F7] dark:bg-[#141416] border border-[#E5E5EA] dark:border-[#2C2C2E] outline-none font-mono text-xs"
                  />
                  <button
                    onClick={handleAddCustomModel}
                    className="px-3 py-1.5 rounded-xl bg-[#0A84FF] text-white font-semibold text-xs hover:bg-[#0A84FF]/90 transition"
                  >
                    添加
                  </button>
                </div>

                {/* 模型清单列表 */}
                <div className="divide-y divide-black/5 dark:divide-white/5 pt-1 max-h-60 overflow-y-auto">
                  {editingProvider.models.length === 0 ? (
                    <div className="py-6 text-center text-[#8E8E93]">暂无模型，可点击右上角拉取或手动添加</div>
                  ) : (
                    editingProvider.models.map(m => {
                      const isModelActive = activeModel === m && activeProviderId === editingProvider.id;
                      const testInfo = modelTestResults[m];
                      const isTesting = testingModelId === m;

                      return (
                        <div key={m} className="py-2.5 flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-semibold truncate">{m}</span>
                              {isModelActive && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-[#0A84FF] text-white font-bold">
                                  使用中
                                </span>
                              )}
                            </div>
                            {testInfo && (
                              <div className={`text-[10px] font-mono mt-0.5 ${testInfo.ok ? "text-[#34C759]" : "text-[#FF453A]"}`}>
                                {testInfo.ok ? `✓ 连通正常 (${testInfo.ms} ms)` : `✕ 连接失败: ${testInfo.err || "超时"}`}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => {
                                onSetActiveProvider(editingProvider.id);
                                onSetActiveModel(m);
                              }}
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold transition ${
                                isModelActive ? "bg-[#0A84FF]/20 text-[#0A84FF]" : "bg-black/5 dark:bg-white/10 text-[#8E8E93] hover:text-black dark:hover:text-white"
                              }`}
                            >
                              设为当前
                            </button>
                            <button
                              onClick={() => handleTestSingleModel(m)}
                              disabled={isTesting}
                              className="p-1 text-[#8E8E93] hover:text-[#FF9F0A] rounded transition"
                              title="Ping 测试此模型连通性与延时"
                            >
                              <Zap className={`w-3.5 h-3.5 ${isTesting ? "animate-spin text-[#FF9F0A]" : ""}`} />
                            </button>
                            <button
                              onClick={() => handleRemoveModel(m)}
                              className="p-1 text-[#8E8E93] hover:text-[#FF453A] rounded transition"
                              title="移除此模型"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
