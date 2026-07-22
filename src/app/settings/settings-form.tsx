"use client";

import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { type UiSettingKey, type UiSettings } from "@/lib/settings-fields";

type FieldConfig = {
  name: UiSettingKey;
  label: string;
  type?: "text" | "password" | "select" | "checkbox";
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
};

type GroupConfig = {
  title: string;
  hint: string;
  fields: FieldConfig[];
};

const browserModeOptions = [
  { value: "false", label: "显示窗口" },
  { value: "true", label: "后台运行" },
];

const groups: GroupConfig[] = [
  {
    title: "1688 采集环境",
    hint: "控制 1688 采集浏览器和网络代理，只影响采集、登录 1688 与商品抓取。",
    fields: [
      { name: "headless", label: "1688 浏览器运行方式", type: "select", options: browserModeOptions },
      { name: "proxy", label: "Proxy", placeholder: "http://user:pass@host:port" },
    ],
  },
  {
    title: "Noon 上传设置",
    hint: "控制 Noon 自动化使用的浏览器内核、输入方式和前后台运行方式。上传目标店铺在商品仓库页选择。",
    fields: [
      {
        name: "noonBrowser",
        label: "Noon 浏览器内核",
        type: "select",
        options: [
          { value: "chrome", label: "系统 Chrome" },
          { value: "cloak", label: "CloakBrowser" },
        ],
      },
      { name: "noonCloakTyping", label: "CloakBrowser 逐字输入", type: "checkbox" },
      { name: "noonHeadless", label: "Noon 浏览器运行方式", type: "select", options: browserModeOptions },
    ],
  },
  {
    title: "运营参数",
    hint: "用于利润计算和 AI 文案生成，不参与店铺登录状态判断。",
    fields: [
      { name: "globalExchangeRate", label: "默认汇率", placeholder: "1.96" },
      { name: "globalPlatformFeeRate", label: "默认平台费率", placeholder: "12%" },
      { name: "globalTargetMargin", label: "默认目标利润率", placeholder: "28%" },
      { name: "deepSeekApiKey", label: "DeepSeek API Key", type: "password", placeholder: "sk-..." },
      {
        name: "deepSeekModel",
        label: "DeepSeek 模型",
        type: "select",
        options: [
          { value: "deepseek-v4-flash", label: "deepseek-v4-flash" },
          { value: "deepseek-v4-pro", label: "deepseek-v4-pro" },
        ],
      },
      {
        name: "catalogType",
        label: "Noon Catalog 类型",
        type: "select",
        options: [
          { value: "global", label: "Global (NGS)" },
          { value: "fbn", label: "FBN/FBP" },
        ],
      },
    ],
  },
];

const fields = groups.flatMap((group) => group.fields);
const leftGroups = groups.slice(0, 2);
const rightGroups = groups.slice(2);

export default function SettingsForm() {
  const [settings, setSettings] = useState<UiSettings>({});
  const [status, setStatus] = useState("读取中...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    fetch("/api/settings")
      .then(async (response) => {
        if (!response.ok) throw new Error("读取配置失败。");
        return response.json() as Promise<UiSettings>;
      })
      .then((data) => {
        if (!active) return;
        setSettings(data);
        setStatus(data.updatedAt ? `上次保存：${data.updatedAt}` : "尚未保存配置。");
      })
      .catch((error) => {
        if (active) setStatus(error instanceof Error ? error.message : "读取配置失败。");
      });

    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus("保存中...");

    const formData = new FormData(event.currentTarget);
    const payload: Record<string, string> = {};

    for (const field of fields) {
      if (field.type === "checkbox") {
        payload[field.name] = formData.get(field.name) === "on" ? "true" : "false";
        continue;
      }

      const value = formData.get(field.name);
      if (value !== null) payload[field.name] = String(value);
    }

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存设置失败。");
      setSettings(data);
      setStatus(`已保存：${data.updatedAt}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存设置失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={save}>
      <div className="settings-layout">
        <div className="settings-stack">
          {leftGroups.map(renderGroup)}
        </div>
        <div className="settings-stack">
          {rightGroups.map(renderGroup)}
        </div>
      </div>
      <div className="settings-actions">
        <span>{status}</span>
        <button disabled={saving} type="submit">{saving ? "保存中" : "保存"}</button>
      </div>
    </form>
  );

  function renderGroup(group: GroupConfig) {
    return (
      <section className="settings-panel" key={group.title}>
        <div className="panel-title"><span>{group.title}</span></div>
        <p className="setting-hint">{group.hint}</p>
        <div className="settings-fields">
          {group.fields.map(renderField)}
        </div>
      </section>
    );
  }

  function renderField(field: FieldConfig) {
    return (
      <label key={field.name}>
        <span>{field.label}</span>
        {field.type === "select" ? (
          <select name={field.name} onChange={updateField(field.name)} value={settings[field.name] || ""}>
            {(field.options || []).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        ) : field.type === "checkbox" ? (
          <span className="checkbox-field">
            <input
              checked={settings[field.name] === "true"}
              name={field.name}
              onChange={updateField(field.name)}
              type="checkbox"
            />
            <em>启用</em>
          </span>
        ) : (
          <input
            name={field.name}
            onChange={updateField(field.name)}
            placeholder={field.placeholder}
            type={field.type || "text"}
            value={settings[field.name] || ""}
          />
        )}
      </label>
    );
  }

  function updateField(field: UiSettingKey) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.target instanceof HTMLInputElement && event.target.type === "checkbox"
        ? String(event.target.checked)
        : event.target.value;
      setSettings((current) => ({ ...current, [field]: value }));
    };
  }
}
