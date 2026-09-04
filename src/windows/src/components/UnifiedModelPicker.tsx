import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Search,
  Zap,
  Check,
  ChevronDown,
  ChevronUp,
  Sliders,
  Layers,
  Edit3,
  Loader2,
  X,
  ExternalLink,
  Plus
} from "lucide-react";
import { Provider } from "./ProviderManager";
import { FullModelGroupsState, ModelGroupItem } from "./ModelGroupManager";

interface UnifiedModelPickerProps {
  providers: Provider[];
  modelGroupsState: FullModelGroupsState;
  activeModel: string;
  activeProviderId: string;
  thinkingLevel: string;
  onSelectModel: (providerId: string, model: string) => void;
  onSelectGroup: (group: ModelGroupItem) => void;
  onSetThinkingLevel: (level: string) => void;
  onOpenGroupManager: (groupId?: string) => void;
  onOpenProviderManager: () => void;
  onClose: () => void;
}

export function UnifiedModelPicker({
  providers,
  modelGroupsState,
  activeModel,
  activeProviderId,
  thinkingLevel,
  onSelectModel,
  onSelectGroup,
  onSetThinkingLevel,
  onOpenGroupManager,
  onOpenProviderManager,
  onClose,
}: UnifiedModelPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  // 记录每个服务商手风琴折叠状态
  const [expandedProviders, setExpandedProviders] = useState<{ [id: string]: boolean }>({});
  // 记录每个模型测活延迟状态
  const [testingModelKey, setTestingModelKey] = useState<string | null>(null);
  const [modelLatencies, setModelLatencies] = useState<{ [key: string]: { ok: boolean; ms?: number; err?: string } }>({});

  const toggleExpand = (providerId: string) => {
    setExpandedProviders(prev => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const handleTestLatency = async (e: React.MouseEvent, provider: Provider, model: string) => {
    e.stopPropagation();
    const key = `${provider.id}:${model}`;
    setTestingModelKey(key);
    try {
      const res = await invoke<{ supports_text: boolean; supports_vision: boolean; latency_ms: number; error?: string }>(
        "test_model_multimodal",
        {
          providerUrl: provider.provider_url,
          apiKey: provider.api_key,
          model,
        }
      );
      setModelLatencies(prev => ({
        ...prev,
        [key]: {
          ok: res.supports_text,
          ms: res.latency_ms,
          err: res.error || (res.supports_vision ? "图文支持" : "纯文本"),
        },
      }));
    } catch (err: any) {
      setModelLatencies(prev => ({ ...prev, [key]: { ok: false, err: String(err) } }));
    } finally {
      setTestingModelKey(null);
    }
  };

  const handleTestGroup = async (e: React.MouseEvent, group: ModelGroupItem) => {
    e.stopPropagation();
    if (group.fallback_models.length === 0) return;
    const firstModel = group.fallback_models[0];
    const ownerProvider = providers.find(p => p.models.includes(firstModel)) || providers[0];
    if (!ownerProvider) return;

    const key = `group:${group.id}`;
    setTestingModelKey(key);
    try {
      const ms = await invoke<number>("test_model_latency", {
        providerUrl: ownerProvider.provider_url,
        apiKey: ownerProvider.api_key,
        model: firstModel,
      });
      setModelLatencies(prev => ({ ...prev, [key]: { ok: true, ms } }));
    } catch (err: any) {
      setModelLatencies(prev => ({ ...prev, [key]: { ok: false, err: String(err) } }));
    } finally {
      setTestingModelKey(null);
    }
  };

  const inferModalityBadges = (modelName: string) => {
    const lower = modelName.toLowerCase();
    const tags: string[] = [];
    if (lower.includes("vision") || lower.includes("vl") || lower.includes("4o") || lower.includes("gemini") || lower.includes("claude-3")) {
      tags.push("img");
    }
    if (lower.includes("audio") || lower.includes("omni") || lower.includes("gemini-2")) {
      tags.push("audio");
    }
    if (lower.includes("video") || lower.includes("kling") || lower.includes("gemini-1.5") || lower.includes("gemini-2")) {
      tags.push("video");
    }
    if (lower.includes("pdf") || lower.includes("doc") || lower.includes("claude") || lower.includes("gpt-4")) {
      tags.push("pdf");
    }
    if (lower.includes("reason") || lower.includes("r1") || lower.includes("o1") || lower.includes("o3")) {
      tags.push("reasoner");
    }
    return tags;
  };

  const query = searchQuery.trim().toLowerCase();

  // 过滤模型分组
  const filteredGroups = modelGroupsState.groups.filter(g =>
    !query || g.name.toLowerCase().includes(query) || g.fallback_models.some(m => m.toLowerCase().includes(query))
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 font-sans select-none animate-in fade-in duration-150">
      <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-lg rounded-[28px] shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">
        {/* 顶栏 (1:1 截图 96ec36a92ed2fe47957daa37efd086b4_032e57.jpg) */}
        <div className="px-6 py-3.5 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
          <h2 className="text-base font-bold text-black dark:text-white">选择模型</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#8E8E93] hover:text-black dark:hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 搜索框 */}
        <div className="p-3 bg-white dark:bg-[#1C1C1E] border-b border-[#E5E5EA] dark:border-[#1C1C1E]">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#2C2C2E] text-xs">
            <Search className="w-4 h-4 text-[#8E8E93]" />
            <input
              type="text"
              placeholder="搜索模型..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-transparent border-none outline-none text-black dark:text-white placeholder-[#8E8E93] text-xs font-medium"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-[#8E8E93] hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* 思考强度分段控制器 */}
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3 border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-1.5">
            <div className="text-[11px] font-semibold text-[#8E8E93] flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-[#0A84FF]" />
              <span>思考模式强度 (Reasoning Effort)</span>
            </div>
            <div className="flex rounded-xl bg-[#F2F2F7] dark:bg-[#141416] p-1 border border-[#E5E5EA] dark:border-[#2C2C2E] text-[11px]">
              {["off", "low", "medium", "high"].map(lvl => (
                <button
                  key={lvl}
                  onClick={() => onSetThinkingLevel(lvl)}
                  className={`flex-1 py-1 rounded-lg uppercase font-semibold transition ${
                    thinkingLevel === lvl ? "bg-[#0A84FF] text-white shadow-sm" : "text-[#8E8E93] hover:text-white"
                  }`}
                >
                  {lvl === "off" ? "关闭" : lvl}
                </button>
              ))}
            </div>
          </div>

          {/* =========================================================================
              Section 1: 模型分组 (1:1 官方截图卡片 + 闪电测活 + 编辑)
          ========================================================================= */}
          {filteredGroups.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-[#8E8E93] px-2 mb-1.5 uppercase tracking-wider">
                模型分组
              </div>
              <div className="space-y-2">
                {filteredGroups.map(group => {
                  const isSelected = activeModel === group.name;
                  const isPrimary = group.name === modelGroupsState.defaults.default_primary_group || group.is_primary;
                  const firstModel = group.fallback_models[0] || "无成员模型";
                  const groupKey = `group:${group.id}`;
                  const testState = modelLatencies[groupKey];
                  const isTesting = testingModelKey === groupKey;

                  return (
                    <div
                      key={group.id}
                      onClick={() => onSelectGroup(group)}
                      className={`p-3.5 rounded-2xl border transition cursor-pointer select-none shadow-sm ${
                        isSelected
                          ? "bg-[#0A84FF]/10 border-[#0A84FF]"
                          : "bg-white dark:bg-[#1C1C1E] border-[#E5E5EA] dark:border-[#2C2C2E] hover:border-[#0A84FF]/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-black dark:text-white">{group.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#AF52DE]/10 text-[#AF52DE] font-bold">
                            分组
                          </span>
                          {isPrimary && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0A84FF]/10 text-[#0A84FF] font-bold">
                              默认
                            </span>
                          )}
                        </div>

                        {/* 闪电测活 + 编辑按钮 */}
                        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={e => handleTestGroup(e, group)}
                            disabled={isTesting}
                            className="p-1.5 rounded-lg bg-[#F2F2F7] dark:bg-[#2C2C2E] hover:opacity-80 transition text-[#8E8E93] hover:text-[#FF9F0A]"
                            title="测试主模型可用性与延迟"
                          >
                            {isTesting ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FF9F0A]" />
                            ) : (
                              <Zap className="w-3.5 h-3.5 text-[#FF9F0A]" />
                            )}
                          </button>
                          <button
                            onClick={() => onOpenGroupManager(group.id)}
                            className="px-2 py-1 rounded-lg bg-[#F2F2F7] dark:bg-[#2C2C2E] text-black dark:text-white text-[11px] font-semibold hover:opacity-80 transition"
                          >
                            编辑
                          </button>
                        </div>
                      </div>

                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#8E8E93]">
                        <div className="truncate max-w-[280px]">
                          <span className="font-semibold text-[#0A84FF]">@ FB </span>
                          <span className="font-mono">{firstModel}</span>
                          {group.fallback_models.length > 1 && (
                            <span> +{group.fallback_models.length - 1}</span>
                          )}
                        </div>

                        {testState && (
                          <span
                            className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded ${
                              testState.ok ? "text-[#34C759] bg-[#34C759]/10" : "text-[#FF453A] bg-[#FF453A]/10"
                            }`}
                          >
                            {testState.ok ? `${testState.ms} ms` : "故障"}
                          </span>
                        )}
                      </div>

                      <div className="text-[10px] text-[#8E8E93] mt-1 border-t border-[#E5E5EA]/40 dark:border-[#2C2C2E]/40 pt-1">
                        将本会话绑定到分组以实现自动回退或负载均衡。
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* =========================================================================
              Section 2: 各服务商独立模型池 (带模态徽标 + ⚡ 闪电测试 + 折叠手风琴)
          ========================================================================= */}
          {providers.map(provider => {
            const providerModels = provider.models.filter(m =>
              !query || m.toLowerCase().includes(query) || provider.name.toLowerCase().includes(query)
            );
            if (providerModels.length === 0) return null;

            const isExpanded = !!expandedProviders[provider.id] || query.length > 0;
            const visibleModels = isExpanded ? providerModels : providerModels.slice(0, 3);
            const hasMore = providerModels.length > 3 && !query;

            return (
              <div key={provider.id}>
                <div className="text-[11px] font-bold text-[#8E8E93] px-2 mb-1 uppercase tracking-wider flex items-center justify-between">
                  <span>{provider.name}</span>
                  <span className="text-[10px] lowercase text-[#8E8E93]">{provider.models.length} 个模型</span>
                </div>

                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  {visibleModels.map(m => {
                    const isSelected = activeModel === m && activeProviderId === provider.id;
                    const badges = inferModalityBadges(m);
                    const key = `${provider.id}:${m}`;
                    const isTesting = testingModelKey === key;
                    const testState = modelLatencies[key];

                    return (
                      <div
                        key={m}
                        onClick={() => onSelectModel(provider.id, m)}
                        className={`p-3 flex items-center justify-between hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition select-none ${
                          isSelected ? "bg-[#0A84FF]/10" : ""
                        }`}
                      >
                        <div className="space-y-1 min-w-0 pr-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-xs font-semibold text-black dark:text-white truncate">
                              {m}
                            </span>
                            {badges.map(tag => (
                              <span
                                key={tag}
                                className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                                  tag === "img"
                                    ? "bg-[#32ADE6]/10 text-[#32ADE6]"
                                    : tag === "audio"
                                    ? "bg-[#34C759]/10 text-[#34C759]"
                                    : tag === "video"
                                    ? "bg-[#AF52DE]/10 text-[#AF52DE]"
                                    : tag === "reasoner"
                                    ? "bg-[#BF5AF2]/15 text-[#BF5AF2]"
                                    : "bg-[#8E8E93]/10 text-[#8E8E93]"
                                }`}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* 右侧：闪电测活 + 选中勾选 */}
                        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                          {testState && (
                            <span
                              className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded ${
                                testState.ok ? "text-[#34C759] bg-[#34C759]/10" : "text-[#FF453A] bg-[#FF453A]/10"
                              }`}
                            >
                              {testState.ok ? `${testState.ms} ms · ${testState.err || "可用"}` : (testState.err || "错误")}
                            </span>
                          )}

                          <button
                            onClick={e => handleTestLatency(e, provider, m)}
                            disabled={isTesting}
                            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[#8E8E93] hover:text-[#FF9F0A] transition"
                            title="测试此模型延迟与连通性"
                          >
                            {isTesting ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FF9F0A]" />
                            ) : (
                              <Zap className="w-3.5 h-3.5 text-[#FF9F0A]" />
                            )}
                          </button>

                          {isSelected && <Check className="w-4 h-4 text-[#0A84FF]" />}
                        </div>
                      </div>
                    );
                  })}

                  {/* 折叠手风琴按钮 (1:1 截图 `v 显示 46 个模型`) */}
                  {hasMore && (
                    <button
                      onClick={() => toggleExpand(provider.id)}
                      className="w-full py-2 bg-[#F2F2F7]/50 dark:bg-[#141416] text-center text-xs font-semibold text-[#8E8E93] hover:text-black dark:hover:text-white transition flex items-center justify-center gap-1"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="w-3.5 h-3.5" />
                          <span>收起模型列表</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>v 显示 {providerModels.length} 个模型</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部按钮栏 */}
        <div className="p-3 border-t border-[#E5E5EA] dark:border-[#1C1C1E] bg-white dark:bg-[#1C1C1E] flex items-center justify-between gap-2">
          <button
            onClick={onOpenProviderManager}
            className="flex-1 py-2 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-black dark:text-white text-xs font-semibold hover:opacity-80 transition flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5 text-[#0A84FF]" />
            <span>AI 服务商管理</span>
          </button>
          <button
            onClick={() => onOpenGroupManager()}
            className="flex-1 py-2 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-black dark:text-white text-xs font-semibold hover:opacity-80 transition flex items-center justify-center gap-1.5"
          >
            <Layers className="w-3.5 h-3.5 text-[#AF52DE]" />
            <span>配置模型分组</span>
          </button>
        </div>
      </div>
    </div>
  );
}
