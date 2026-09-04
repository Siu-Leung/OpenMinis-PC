import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Plus,
  ChevronRight,
  Check,
  Trash2,
  Brain,
  Sliders,
  Sparkles,
  Layers,
  ArrowDown,
  ArrowUp,
  X,
  PlusCircle,
  HelpCircle,
  FolderPlus
} from "lucide-react";
import { Provider } from "./ProviderManager";

export interface GroupModelEntry {
  model: string;
  provider_id?: string;
  provider_label?: string;
}

export interface ModelGroupItem {
  id: string;
  name: string;
  is_primary: boolean;
  routing_strategy?: "fallback" | "load_balance";
  fallback_condition?: "default" | "always";
  fallback_models: string[];
  models_detail?: GroupModelEntry[];
  enable_thinking?: boolean;
  thinking_effort?: "low" | "medium" | "high" | "max";
  limit_context?: boolean;
  max_context?: "32K" | "64K" | "128K" | "unlimited";
  description?: string;
}

export interface DefaultsConfig {
  default_primary_group: string;
  default_sub_model: string;
  voice_input: string;
  voice_output: string;
  vision_input: string;
}

export interface AgentLoopModelEntry {
  id: string;
  name: string;
  is_group: boolean;
  model_count: number;
}

export interface FullModelGroupsState {
  groups: ModelGroupItem[];
  defaults: DefaultsConfig;
  agent_loop_models: AgentLoopModelEntry[];
}

interface ModelGroupManagerProps {
  state: FullModelGroupsState;
  providers: Provider[];
  onSaveState: (next: FullModelGroupsState) => void;
  onClose: () => void;
}

export function ModelGroupManager({
  state,
  providers,
  onSaveState,
  onClose,
}: ModelGroupManagerProps) {
  const [subView, setSubView] = useState<"list" | "detail">("list");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // 新建分组弹窗状态 (对标 7e949c12ab3e2362e4b12853475f0462_e8b2eb.jpg)
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newGroupNameInput, setNewGroupNameInput] = useState("");

  // 添加模型至分组弹窗
  const [showAddModelModal, setShowAddModelModal] = useState(false);

  // Minis 运行时添加模型 / 分组弹窗
  const [showAddAgentModelModal, setShowAddAgentModelModal] = useState(false);
  const [showAddAgentGroupModal, setShowAddAgentGroupModal] = useState(false);

  const selectedGroup = state.groups.find(g => g.id === selectedGroupId);

  const updateGroup = (updated: ModelGroupItem) => {
    const nextGroups = state.groups.map(g => (g.id === updated.id ? updated : g));
    const nextState = { ...state, groups: nextGroups };
    onSaveState(nextState);
  };

  const handleCreateGroup = () => {
    const trimmed = newGroupNameInput.trim();
    if (!trimmed) return;

    const newId = `group-${Date.now().toString(36)}`;
    const isFirst = state.groups.length === 0;

    const newGroup: ModelGroupItem = {
      id: newId,
      name: trimmed,
      is_primary: isFirst,
      routing_strategy: "fallback",
      fallback_condition: "default",
      fallback_models: [],
      models_detail: [],
      enable_thinking: false,
      thinking_effort: "medium",
      limit_context: false,
      max_context: "128K",
      description: "",
    };

    const nextGroups = [...state.groups, newGroup];
    const nextDefaults = {
      ...state.defaults,
      default_primary_group: isFirst ? newGroup.name : state.defaults.default_primary_group,
    };

    const nextState: FullModelGroupsState = {
      ...state,
      groups: nextGroups,
      defaults: nextDefaults,
    };

    onSaveState(nextState);
    setNewGroupNameInput("");
    setShowCreateDialog(false);
    setSelectedGroupId(newId);
    setSubView("detail");
  };

  const handleDeleteGroup = (id: string) => {
    const g = state.groups.find(x => x.id === id);
    if (!g) return;
    if (
      !confirm(
        `确定删除分组 “${g.name}” 吗？绑定到此分组的默认设置将被清除，模型本身不会被删除。`
      )
    ) {
      return;
    }

    const nextGroups = state.groups.filter(x => x.id !== id);
    const nextDefaults = { ...state.defaults };
    if (nextDefaults.default_primary_group === g.name) {
      nextDefaults.default_primary_group = nextGroups.length > 0 ? nextGroups[0].name : "无";
    }
    if (nextDefaults.default_sub_model === g.name) {
      nextDefaults.default_sub_model = "无";
    }

    const nextState = {
      ...state,
      groups: nextGroups,
      defaults: nextDefaults,
      agent_loop_models: state.agent_loop_models.filter(m => m.id !== id),
    };
    onSaveState(nextState);
    setSubView("list");
  };

  const handleAddModelToGroup = (model: string, providerLabel: string, providerId: string) => {
    if (!selectedGroup) return;
    const exists = selectedGroup.fallback_models.includes(model);
    if (exists) return;

    const nextModels = [...selectedGroup.fallback_models, model];
    const nextDetail = [
      ...(selectedGroup.models_detail || []),
      { model, provider_label: providerLabel, provider_id: providerId },
    ];

    updateGroup({
      ...selectedGroup,
      fallback_models: nextModels,
      models_detail: nextDetail,
    });
  };

  const handleRemoveModelFromGroup = (model: string) => {
    if (!selectedGroup) return;
    const nextModels = selectedGroup.fallback_models.filter(m => m !== model);
    const nextDetail = (selectedGroup.models_detail || []).filter(d => d.model !== model);

    updateGroup({
      ...selectedGroup,
      fallback_models: nextModels,
      models_detail: nextDetail,
    });
  };

  const handleMoveModel = (index: number, direction: "up" | "down") => {
    if (!selectedGroup) return;
    const models = [...selectedGroup.fallback_models];
    const details = [...(selectedGroup.models_detail || [])];

    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= models.length) return;

    const tempM = models[index];
    models[index] = models[targetIdx];
    models[targetIdx] = tempM;

    if (details.length === models.length) {
      const tempD = details[index];
      details[index] = details[targetIdx];
      details[targetIdx] = tempD;
    }

    updateGroup({
      ...selectedGroup,
      fallback_models: models,
      models_detail: details,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 font-sans">
      <div className="bg-[#F2F2F7] dark:bg-[#000000] border border-[#E5E5EA] dark:border-[#1C1C1E] w-full max-w-xl rounded-[28px] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden select-none animate-in fade-in zoom-in-95 duration-150">
        {/* =========================================================================
            视图 1: 模型分组主页面 (1:1 原版截图 cf1d43b0ba71baec8fff05ab1f4c6679_e77772.jpg)
        ========================================================================= */}
        {subView === "list" && (
          <>
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  className="p-1 rounded-lg text-black dark:text-white hover:opacity-80 transition"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white">模型分组</h2>
              </div>
              <button
                onClick={() => {
                  setNewGroupNameInput("");
                  setShowCreateDialog(true);
                }}
                className="w-7 h-7 rounded-full bg-[#0A84FF] text-white flex items-center justify-center hover:opacity-90 transition shadow-sm"
                title="新建分组"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
              {/* 分组列表 (Section 分组) */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider">
                  分组
                </div>
                {state.groups.length === 0 ? (
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-8 border border-[#E5E5EA] dark:border-[#2C2C2E] text-center space-y-3">
                    <div className="w-12 h-12 rounded-full bg-[#2C2C2E]/20 flex items-center justify-center mx-auto text-[#8E8E93]">
                      <Layers className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-black dark:text-white">暂无模型分组</div>
                      <div className="text-xs text-[#8E8E93] mt-1">
                        分组允许你组合多个模型以实现错误自动回退或并发负载均衡。
                      </div>
                    </div>
                    <button
                      onClick={() => setShowCreateDialog(true)}
                      className="px-4 py-2 rounded-xl bg-[#0A84FF] text-white font-semibold text-xs shadow-sm hover:opacity-90 transition"
                    >
                      新建模型分组
                    </button>
                  </div>
                ) : (
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                    {state.groups.map(group => {
                      const isPrimary = group.name === state.defaults.default_primary_group || group.is_primary;
                      const strategyLabel = group.routing_strategy === "load_balance" ? "负载均衡" : "回退";
                      const modelsCount = group.fallback_models.length;
                      const modelsSummary =
                        group.fallback_models.length > 0
                          ? group.fallback_models.slice(0, 3).join(", ") +
                            (group.fallback_models.length > 3 ? ` +${group.fallback_models.length - 3}` : "")
                          : "暂无模型";

                      return (
                        <div
                          key={group.id}
                          onClick={() => {
                            setSelectedGroupId(group.id);
                            setSubView("detail");
                          }}
                          className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] cursor-pointer transition select-none"
                        >
                          <div className="space-y-1 min-w-0 pr-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-black dark:text-white truncate">
                                {group.name}
                              </span>
                              {isPrimary && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0A84FF]/10 text-[#0A84FF] font-bold">
                                  Primary
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#8E8E93] flex items-center gap-1.5">
                              <span>{strategyLabel}</span>
                              <span>·</span>
                              <span>{modelsCount} models</span>
                            </div>
                            <div className="text-[11px] text-[#8E8E93] font-mono truncate max-w-sm">
                              {modelsSummary}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-[#8E8E93] shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 默认值分配 (Section Defaults) */}
              {state.groups.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider">
                    Defaults
                  </div>
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E] text-xs">
                    {/* Default Primary */}
                    <div className="flex items-center justify-between p-3.5">
                      <div className="font-medium text-black dark:text-white">Default Primary</div>
                      <select
                        value={state.defaults.default_primary_group}
                        onChange={e => {
                          const val = e.target.value;
                          const nextGroups = state.groups.map(g => ({
                            ...g,
                            is_primary: g.name === val,
                          }));
                          onSaveState({
                            ...state,
                            groups: nextGroups,
                            defaults: { ...state.defaults, default_primary_group: val },
                          });
                        }}
                        className="bg-[#F2F2F7] dark:bg-[#2C2C2E] text-black dark:text-white border border-[#E5E5EA] dark:border-[#3A3A3C] rounded-lg px-2.5 py-1 outline-none text-xs font-semibold"
                      >
                        <option value="无">无</option>
                        {state.groups.map(g => (
                          <option key={g.id} value={g.name}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Default Sub */}
                    <div className="flex items-center justify-between p-3.5">
                      <div className="font-medium text-black dark:text-white">Default Sub</div>
                      <select
                        value={state.defaults.default_sub_model}
                        onChange={e =>
                          onSaveState({
                            ...state,
                            defaults: { ...state.defaults, default_sub_model: e.target.value },
                          })
                        }
                        className="bg-[#F2F2F7] dark:bg-[#2C2C2E] text-black dark:text-white border border-[#E5E5EA] dark:border-[#3A3A3C] rounded-lg px-2.5 py-1 outline-none text-xs font-semibold"
                      >
                        <option value="无">无</option>
                        {state.groups.map(g => (
                          <option key={g.id} value={g.name}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 语音输入 */}
                    <div className="flex items-center justify-between p-3.5">
                      <div className="font-medium text-black dark:text-white">语音输入</div>
                      <select
                        value={state.defaults.voice_input}
                        onChange={e =>
                          onSaveState({
                            ...state,
                            defaults: { ...state.defaults, voice_input: e.target.value },
                          })
                        }
                        className="bg-[#F2F2F7] dark:bg-[#2C2C2E] text-black dark:text-white border border-[#E5E5EA] dark:border-[#3A3A3C] rounded-lg px-2.5 py-1 outline-none text-xs font-semibold"
                      >
                        <option value="无">无</option>
                        {state.groups.map(g => (
                          <option key={g.id} value={g.name}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 语音输出 */}
                    <div className="flex items-center justify-between p-3.5">
                      <div className="font-medium text-black dark:text-white">语音输出</div>
                      <select
                        value={state.defaults.voice_output}
                        onChange={e =>
                          onSaveState({
                            ...state,
                            defaults: { ...state.defaults, voice_output: e.target.value },
                          })
                        }
                        className="bg-[#F2F2F7] dark:bg-[#2C2C2E] text-black dark:text-white border border-[#E5E5EA] dark:border-[#3A3A3C] rounded-lg px-2.5 py-1 outline-none text-xs font-semibold"
                      >
                        <option value="无">无</option>
                        {state.groups.map(g => (
                          <option key={g.id} value={g.name}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 视觉输入 */}
                    <div className="flex items-center justify-between p-3.5">
                      <div className="font-medium text-black dark:text-white">视觉输入</div>
                      <select
                        value={state.defaults.vision_input}
                        onChange={e =>
                          onSaveState({
                            ...state,
                            defaults: { ...state.defaults, vision_input: e.target.value },
                          })
                        }
                        className="bg-[#F2F2F7] dark:bg-[#2C2C2E] text-black dark:text-white border border-[#E5E5EA] dark:border-[#3A3A3C] rounded-lg px-2.5 py-1 outline-none text-xs font-semibold"
                      >
                        <option value="无">无</option>
                        {state.groups.map(g => (
                          <option key={g.id} value={g.name}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="text-[11px] text-[#8E8E93] px-3 mt-1.5 leading-relaxed">
                    主模型用于主要任务，辅助模型用于标题生成等轻量任务。未设置辅助模型时将继承主模型。
                  </div>
                </div>
              )}

              {/* Minis 运行时可调用的模型 (Section Minis 运行时可调用的模型) */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1.5 uppercase tracking-wider">
                  Minis 运行时可调用的模型
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  {state.agent_loop_models.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[#8E8E93]">
                      暂无模型条目。Agent 默认仅能调用当前会话的模型。
                    </div>
                  ) : (
                    state.agent_loop_models.map(item => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-3.5 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-black dark:text-white">{item.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#AF52DE]/10 text-[#AF52DE] font-bold">
                            {item.is_group ? "分组" : "模型"}
                          </span>
                          <span className="text-[11px] text-[#8E8E93]">
                            {item.model_count > 0 ? `${item.model_count} 个模型` : "独立模型"}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            const next = state.agent_loop_models.filter(x => x.id !== item.id);
                            onSaveState({ ...state, agent_loop_models: next });
                          }}
                          className="p-1 text-[#8E8E93] hover:text-[#FF453A] transition"
                          title="移除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}

                  {/* 底部 + 添加模型 / + 添加分组 */}
                  <div className="p-2.5 bg-[#F2F2F7]/50 dark:bg-[#141416] flex items-center justify-around gap-2">
                    <button
                      onClick={() => setShowAddAgentModelModal(true)}
                      className="flex-1 py-1.5 rounded-xl bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] text-black dark:text-white font-semibold hover:bg-black/5 dark:hover:bg-white/5 transition flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#0A84FF]" />
                      <span>添加模型</span>
                    </button>
                    <button
                      onClick={() => setShowAddAgentGroupModal(true)}
                      className="flex-1 py-1.5 rounded-xl bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] text-black dark:text-white font-semibold hover:bg-black/5 dark:hover:bg-white/5 transition flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <FolderPlus className="w-3.5 h-3.5 text-[#34C759]" />
                      <span>添加分组</span>
                    </button>
                  </div>
                </div>
                <div className="text-[11px] text-[#8E8E93] px-3 mt-1.5 leading-relaxed">
                  在 Minis 任务中，Agent 会调用这些模型来完成生图、总结等子任务 ——
                  也就是它自身模型做不到的工作。也可在终端通过 minis-model-use 调用。只有这些对 Agent 可见。
                </div>
              </div>
            </div>
          </>
        )}

        {/* =========================================================================
            视图 2: 分组详情页 (1:1 原版截图 6a7e7d9bc6fe847b278544e2274b888f_5f106c.jpg)
        ========================================================================= */}
        {subView === "detail" && selectedGroup && (
          <>
            <div className="px-6 py-4 border-b border-[#E5E5EA] dark:border-[#1C1C1E] flex items-center justify-between bg-white dark:bg-[#1C1C1E]">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSubView("list")}
                  className="p-1 rounded-lg text-black dark:text-white hover:opacity-80 transition"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-black dark:text-white truncate max-w-[240px]">
                  {selectedGroup.name}
                </h2>
              </div>
              <button
                onClick={() => setSubView("list")}
                className="px-4 py-1.5 rounded-xl bg-[#0A84FF] text-white text-xs font-semibold hover:opacity-90 shadow-sm transition"
              >
                完成
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {/* 卡片 1: 名称 */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider">
                  名称
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3 border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  <input
                    type="text"
                    value={selectedGroup.name}
                    onChange={e => updateGroup({ ...selectedGroup, name: e.target.value })}
                    placeholder="输入模型分组名称"
                    className="w-full bg-transparent border-none outline-none text-black dark:text-white font-bold text-sm"
                  />
                </div>
                <div className="text-[11px] text-[#8E8E93] px-3 mt-1">
                  在模型选择器里显示的标签。点击其它位置时自动保存。
                </div>
              </div>

              {/* 卡片 2: 路由策略 */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider">
                  路由策略
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3 border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-2">
                  <div className="flex rounded-xl bg-[#F2F2F7] dark:bg-[#141416] p-1 border border-[#E5E5EA] dark:border-[#2C2C2E]">
                    <button
                      onClick={() => updateGroup({ ...selectedGroup, routing_strategy: "fallback" })}
                      className={`flex-1 py-1.5 rounded-lg font-semibold transition ${
                        (selectedGroup.routing_strategy || "fallback") === "fallback"
                          ? "bg-[#0A84FF] text-white shadow-sm"
                          : "text-[#8E8E93] hover:text-white"
                      }`}
                    >
                      回退
                    </button>
                    <button
                      onClick={() => updateGroup({ ...selectedGroup, routing_strategy: "load_balance" })}
                      className={`flex-1 py-1.5 rounded-lg font-semibold transition ${
                        selectedGroup.routing_strategy === "load_balance"
                          ? "bg-[#0A84FF] text-white shadow-sm"
                          : "text-[#8E8E93] hover:text-white"
                      }`}
                    >
                      负载均衡
                    </button>
                  </div>
                  <div className="text-[11px] text-[#8E8E93] leading-relaxed">
                    {selectedGroup.routing_strategy === "load_balance"
                      ? "Sessions are distributed across models. Each session sticks to its assigned model unless it fails."
                      : "Try models in order. If one fails, advance to the next."}
                  </div>
                </div>
              </div>

              {/* 卡片 3: FALLBACK 触发条件 (仅回退模式显示) */}
              {(selectedGroup.routing_strategy || "fallback") === "fallback" && (
                <div>
                  <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider">
                    FALLBACK 触发条件
                  </div>
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-3 border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-2">
                    <div className="flex rounded-xl bg-[#F2F2F7] dark:bg-[#141416] p-1 border border-[#E5E5EA] dark:border-[#2C2C2E]">
                      <button
                        onClick={() => updateGroup({ ...selectedGroup, fallback_condition: "default" })}
                        className={`flex-1 py-1.5 rounded-lg font-semibold transition ${
                          (selectedGroup.fallback_condition || "default") === "default"
                            ? "bg-[#0A84FF] text-white shadow-sm"
                            : "text-[#8E8E93] hover:text-white"
                        }`}
                      >
                        默认
                      </button>
                      <button
                        onClick={() => updateGroup({ ...selectedGroup, fallback_condition: "always" })}
                        className={`flex-1 py-1.5 rounded-lg font-semibold transition ${
                          selectedGroup.fallback_condition === "always"
                            ? "bg-[#0A84FF] text-white shadow-sm"
                            : "text-[#8E8E93] hover:text-white"
                        }`}
                      >
                        始终
                      </button>
                    </div>
                    <div className="text-[11px] text-[#8E8E93] leading-relaxed">
                      {selectedGroup.fallback_condition === "always"
                        ? "Switch to the next model on any error without retrying."
                        : "Fail back on rate limits (429) and server errors (5xx) only."}
                    </div>
                  </div>
                </div>
              )}

              {/* 卡片 4: 模型列表 (含所属提供商标签与排序) */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider flex items-center justify-between">
                  <span>模型 ({selectedGroup.fallback_models.length})</span>
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                  {selectedGroup.fallback_models.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#8E8E93]">
                      该分组暂无模型，请点击下方 “+ 添加模型”
                    </div>
                  ) : (
                    selectedGroup.fallback_models.map((model, idx) => {
                      const detail = (selectedGroup.models_detail || []).find(d => d.model === model);
                      // 尝试在 providers 中找到属于哪个服务商
                      const ownerProvider =
                        providers.find(p => p.models.includes(model)) ||
                        providers.find(p => p.id === detail?.provider_id);
                      const label = detail?.provider_label || ownerProvider?.name || "AI";

                      return (
                        <div
                          key={model}
                          className="flex items-center justify-between p-3 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition"
                        >
                          <div className="space-y-0.5 min-w-0 pr-2">
                            <div className="font-mono text-xs text-black dark:text-white font-medium truncate">
                              {model}
                            </div>
                            <div className="text-[10px] text-[#8E8E93] font-semibold">{label}</div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleMoveModel(idx, "up")}
                              disabled={idx === 0}
                              className="p-1 text-[#8E8E93] hover:text-black dark:hover:text-white disabled:opacity-20"
                              title="上移"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleMoveModel(idx, "down")}
                              disabled={idx === selectedGroup.fallback_models.length - 1}
                              className="p-1 text-[#8E8E93] hover:text-black dark:hover:text-white disabled:opacity-20"
                              title="下移"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleRemoveModelFromGroup(model)}
                              className="p-1 text-[#8E8E93] hover:text-[#FF453A]"
                              title="移除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}

                  {/* 添加模型按钮 */}
                  <div className="p-3 bg-[#F2F2F7]/50 dark:bg-[#141416]">
                    <button
                      onClick={() => setShowAddModelModal(true)}
                      className="w-full py-2 rounded-xl bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] text-black dark:text-white font-semibold text-xs hover:opacity-80 transition flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <Plus className="w-4 h-4 text-[#0A84FF]" />
                      <span>添加模型</span>
                    </button>
                  </div>
                </div>
                <div className="text-[11px] text-[#8E8E93] px-3 mt-1">
                  拖拽或使用箭头调整顺序。排在首位的模型将被优先尝试。
                </div>
              </div>

              {/* 卡片 5: 会话默认值 */}
              <div>
                <div className="text-[11px] font-bold text-[#8E8E93] px-3 mb-1 uppercase tracking-wider">
                  会话默认值
                </div>
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E] text-xs">
                  {/* 启用思考 */}
                  <div className="flex items-center justify-between p-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-[#AF52DE] flex items-center justify-center text-white">
                        <Brain className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-semibold text-black dark:text-white">启用思考</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedGroup.enable_thinking ?? false}
                      onChange={e =>
                        updateGroup({ ...selectedGroup, enable_thinking: e.target.checked })
                      }
                      className="w-4 h-4 accent-[#0A84FF]"
                    />
                  </div>

                  {/* 思考强度分段按钮 */}
                  {selectedGroup.enable_thinking && (
                    <div className="p-3 space-y-1.5">
                      <div className="text-[11px] font-semibold text-[#8E8E93]">思考强度</div>
                      <div className="flex rounded-xl bg-[#F2F2F7] dark:bg-[#141416] p-1 border border-[#E5E5EA] dark:border-[#2C2C2E]">
                        {[
                          { id: "medium", label: "中" },
                          { id: "high", label: "高" },
                          { id: "max", label: "超高" },
                        ].map(tier => (
                          <button
                            key={tier.id}
                            onClick={() =>
                              updateGroup({
                                ...selectedGroup,
                                thinking_effort: tier.id as any,
                              })
                            }
                            className={`flex-1 py-1 rounded-lg font-semibold transition ${
                              (selectedGroup.thinking_effort || "medium") === tier.id
                                ? "bg-[#0A84FF] text-white shadow-sm"
                                : "text-[#8E8E93] hover:text-white"
                            }`}
                          >
                            {tier.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 限制上下文窗口 */}
                  <div className="flex items-center justify-between p-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-[#32ADE6] flex items-center justify-center text-white">
                        <Sliders className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-semibold text-black dark:text-white">
                        限制上下文窗口
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedGroup.limit_context ?? false}
                      onChange={e =>
                        updateGroup({ ...selectedGroup, limit_context: e.target.checked })
                      }
                      className="w-4 h-4 accent-[#0A84FF]"
                    />
                  </div>

                  {/* 最大上下文分段按钮 */}
                  {selectedGroup.limit_context && (
                    <div className="p-3 space-y-1.5">
                      <div className="text-[11px] font-semibold text-[#8E8E93]">最大上下文</div>
                      <div className="flex rounded-xl bg-[#F2F2F7] dark:bg-[#141416] p-1 border border-[#E5E5EA] dark:border-[#2C2C2E]">
                        {["32K", "64K", "128K", "unlimited"].map(tokenLimit => (
                          <button
                            key={tokenLimit}
                            onClick={() =>
                              updateGroup({
                                ...selectedGroup,
                                max_context: tokenLimit as any,
                              })
                            }
                            className={`flex-1 py-1 rounded-lg font-semibold transition ${
                              (selectedGroup.max_context || "128K") === tokenLimit
                                ? "bg-[#0A84FF] text-white shadow-sm"
                                : "text-[#8E8E93] hover:text-white"
                            }`}
                          >
                            {tokenLimit === "unlimited" ? "不限" : tokenLimit}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-[#8E8E93] px-3 mt-1">
                  绑定到此分组的新会话将自动应用。
                </div>
              </div>

              {/* 设为 Primary 默认分组 */}
              <button
                onClick={() => {
                  const nextGroups = state.groups.map(g => ({
                    ...g,
                    is_primary: g.id === selectedGroup.id,
                  }));
                  onSaveState({
                    ...state,
                    groups: nextGroups,
                    defaults: { ...state.defaults, default_primary_group: selectedGroup.name },
                  });
                  alert(`已将 “${selectedGroup.name}” 设为系统 Primary 默认分组！`);
                }}
                className="w-full py-2.5 rounded-2xl bg-[#0A84FF]/10 text-[#0A84FF] font-semibold text-xs hover:bg-[#0A84FF]/20 transition"
              >
                设为 Primary 默认主分组
              </button>

              {/* 删除分组 */}
              <button
                onClick={() => handleDeleteGroup(selectedGroup.id)}
                className="w-full py-2.5 rounded-2xl bg-[#FF453A]/10 text-[#FF453A] font-semibold text-xs hover:bg-[#FF453A]/20 transition flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>删除分组</span>
              </button>
            </div>
          </>
        )}

        {/* =========================================================================
            模态弹窗 1: 新建分组 (1:1 截图 7e949c12ab3e2362e4b12853475f0462_e8b2eb.jpg)
        ========================================================================= */}
        {showCreateDialog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] w-full max-w-sm rounded-[24px] shadow-2xl p-5 select-none animate-in fade-in zoom-in-95 duration-100 space-y-4">
              <div>
                <h3 className="text-base font-bold text-black dark:text-white">新建分组</h3>
                <p className="text-xs text-[#8E8E93] mt-1">
                  Enter a name for the new model group.
                </p>
              </div>

              <div className="bg-[#F2F2F7] dark:bg-[#141416] rounded-xl px-3 py-2 border border-[#E5E5EA] dark:border-[#2C2C2E]">
                <input
                  autoFocus
                  type="text"
                  placeholder="分组名称"
                  value={newGroupNameInput}
                  onChange={e => setNewGroupNameInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleCreateGroup();
                  }}
                  className="w-full bg-transparent border-none outline-none text-black dark:text-white text-xs font-semibold"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setShowCreateDialog(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[#8E8E93] hover:bg-black/5 dark:hover:bg-white/5 transition"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateGroup}
                  disabled={!newGroupNameInput.trim()}
                  className="px-4 py-2 rounded-xl bg-[#0A84FF] text-white text-xs font-semibold hover:opacity-90 transition disabled:opacity-40"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            模态弹窗 2: 为分组添加模型
        ========================================================================= */}
        {showAddModelModal && selectedGroup && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] w-full max-w-md rounded-[24px] shadow-2xl p-5 select-none animate-in fade-in zoom-in-95 duration-100 flex flex-col max-h-[75vh]">
              <div className="flex items-center justify-between pb-3 border-b border-[#E5E5EA] dark:border-[#2C2C2E]">
                <div>
                  <h3 className="text-base font-bold text-black dark:text-white">选择要添加的模型</h3>
                  <p className="text-xs text-[#8E8E93]">来自已配置的 AI 服务商</p>
                </div>
                <button
                  onClick={() => setShowAddModelModal(false)}
                  className="p-1 text-[#8E8E93] hover:text-black dark:hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-3 space-y-4">
                {providers.map(p => (
                  <div key={p.id} className="space-y-1.5">
                    <div className="text-[11px] font-bold text-[#8E8E93] uppercase px-1">
                      {p.name} ({p.models.length})
                    </div>
                    <div className="bg-[#F2F2F7] dark:bg-[#141416] rounded-xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E] border border-[#E5E5EA] dark:border-[#2C2C2E]">
                      {p.models.length === 0 ? (
                        <div className="p-2 text-center text-xs text-[#8E8E93]">未配置模型</div>
                      ) : (
                        p.models.map(m => {
                          const isAdded = selectedGroup.fallback_models.includes(m);
                          return (
                            <div
                              key={m}
                              onClick={() => {
                                if (isAdded) {
                                  handleRemoveModelFromGroup(m);
                                } else {
                                  handleAddModelToGroup(m, p.name, p.id);
                                }
                              }}
                              className="flex items-center justify-between p-2.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition select-none"
                            >
                              <span className="font-mono text-xs text-black dark:text-white">
                                {m}
                              </span>
                              <div
                                className={`w-4 h-4 rounded-full flex items-center justify-center text-white ${
                                  isAdded ? "bg-[#0A84FF]" : "border border-[#8E8E93]"
                                }`}
                              >
                                {isAdded && <Check className="w-2.5 h-2.5" />}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-[#E5E5EA] dark:border-[#2C2C2E] flex justify-end">
                <button
                  onClick={() => setShowAddModelModal(false)}
                  className="px-5 py-2 rounded-xl bg-[#0A84FF] text-white text-xs font-semibold hover:opacity-90 transition"
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            模态弹窗 3: 运行时添加模型
        ========================================================================= */}
        {showAddAgentModelModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] w-full max-w-md rounded-[24px] shadow-2xl p-5 select-none flex flex-col max-h-[75vh]">
              <div className="flex items-center justify-between pb-3 border-b border-[#E5E5EA] dark:border-[#2C2C2E]">
                <h3 className="text-base font-bold text-black dark:text-white">
                  添加供 Agent 调用的模型
                </h3>
                <button onClick={() => setShowAddAgentModelModal(false)}>
                  <X className="w-5 h-5 text-[#8E8E93]" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-3 space-y-2">
                {providers.flatMap(p => p.models).map(m => {
                  const isAdded = state.agent_loop_models.some(item => item.name === m);
                  return (
                    <div
                      key={m}
                      onClick={() => {
                        if (isAdded) {
                          onSaveState({
                            ...state,
                            agent_loop_models: state.agent_loop_models.filter(
                              item => item.name !== m
                            ),
                          });
                        } else {
                          onSaveState({
                            ...state,
                            agent_loop_models: [
                              ...state.agent_loop_models,
                              { id: m, name: m, is_group: false, model_count: 0 },
                            ],
                          });
                        }
                      }}
                      className="p-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#141416] hover:opacity-90 flex items-center justify-between cursor-pointer border border-[#E5E5EA] dark:border-[#2C2C2E]"
                    >
                      <span className="font-mono text-xs text-black dark:text-white">{m}</span>
                      <div
                        className={`w-4 h-4 rounded-full flex items-center justify-center text-white ${
                          isAdded ? "bg-[#0A84FF]" : "border border-[#8E8E93]"
                        }`}
                      >
                        {isAdded && <Check className="w-2.5 h-2.5" />}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="pt-3 border-t border-[#E5E5EA] dark:border-[#2C2C2E] flex justify-end">
                <button
                  onClick={() => setShowAddAgentModelModal(false)}
                  className="px-5 py-2 rounded-xl bg-[#0A84FF] text-white text-xs font-semibold"
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            模态弹窗 4: 运行时添加分组
        ========================================================================= */}
        {showAddAgentGroupModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] w-full max-w-md rounded-[24px] shadow-2xl p-5 select-none flex flex-col max-h-[75vh]">
              <div className="flex items-center justify-between pb-3 border-b border-[#E5E5EA] dark:border-[#2C2C2E]">
                <h3 className="text-base font-bold text-black dark:text-white">
                  添加供 Agent 调用的分组
                </h3>
                <button onClick={() => setShowAddAgentGroupModal(false)}>
                  <X className="w-5 h-5 text-[#8E8E93]" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-3 space-y-2">
                {state.groups.map(g => {
                  const isAdded = state.agent_loop_models.some(item => item.id === g.id);
                  return (
                    <div
                      key={g.id}
                      onClick={() => {
                        if (isAdded) {
                          onSaveState({
                            ...state,
                            agent_loop_models: state.agent_loop_models.filter(
                              item => item.id !== g.id
                            ),
                          });
                        } else {
                          onSaveState({
                            ...state,
                            agent_loop_models: [
                              ...state.agent_loop_models,
                              {
                                id: g.id,
                                name: g.name,
                                is_group: true,
                                model_count: g.fallback_models.length,
                              },
                            ],
                          });
                        }
                      }}
                      className="p-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#141416] hover:opacity-90 flex items-center justify-between cursor-pointer border border-[#E5E5EA] dark:border-[#2C2C2E]"
                    >
                      <div>
                        <div className="font-bold text-xs text-black dark:text-white">
                          {g.name}
                        </div>
                        <div className="text-[11px] text-[#8E8E93]">
                          {g.fallback_models.length} 个模型
                        </div>
                      </div>
                      <div
                        className={`w-4 h-4 rounded-full flex items-center justify-center text-white ${
                          isAdded ? "bg-[#0A84FF]" : "border border-[#8E8E93]"
                        }`}
                      >
                        {isAdded && <Check className="w-2.5 h-2.5" />}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="pt-3 border-t border-[#E5E5EA] dark:border-[#2C2C2E] flex justify-end">
                <button
                  onClick={() => setShowAddAgentGroupModal(false)}
                  className="px-5 py-2 rounded-xl bg-[#0A84FF] text-white text-xs font-semibold"
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
