"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type NoonStore = {
  id: string;
  name: string;
  projectId: string;
  createdAt: string;
  url: string;
  hasApiToken: boolean;
};

type StoreState = {
  stores: NoonStore[];
  defaultStoreId: string;
};

const emptyForm = { id: "", name: "", projectId: "", apiToken: "" };

export default function StoresWorkspace() {
  const [state, setState] = useState<StoreState>({ stores: [], defaultStoreId: "" });
  const [storeSearch, setStoreSearch] = useState("");
  const [status, setStatus] = useState("读取店铺中...");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [tokenDialogStore, setTokenDialogStore] = useState<NoonStore | null>(null);
  const [tokenValue, setTokenValue] = useState("");

  useEffect(() => {
    void loadStores();
  }, []);

  async function loadStores(selectedStoreId = "") {
    try {
      const response = await fetch("/api/stores");
      const result = await response.json() as StoreState & { error?: string };
      if (!response.ok) throw new Error(result.error || "读取店铺失败。");
      setState({
        stores: result.stores || [],
        defaultStoreId: selectedStoreId || result.defaultStoreId || result.stores?.[0]?.id || "",
      });
      setStatus(result.stores?.length ? "选择店铺后点击检测登录。" : "暂无店铺。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取店铺失败。");
    }
  }

  async function saveStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await fetch("/api/stores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json() as { store?: NoonStore; error?: string };
      if (!response.ok || !result.store) throw new Error(result.error || "保存店铺失败。");
      setDialogOpen(false);
      setForm(emptyForm);
      await setDefaultStore(result.store.id);
      await loadStores(result.store.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存店铺失败。");
    }
  }

  async function setDefaultStore(storeId: string) {
    try {
      setState((current) => ({ ...current, defaultStoreId: storeId }));
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultStoreId: storeId }),
      });
      if (!response.ok) throw new Error("保存默认店铺失败。");
      setStatus("默认店铺已更新。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存默认店铺失败。");
    }
  }

  async function removeStore(store: NoonStore) {
    if (!window.confirm(`删除店铺 ${store.id}？本地登录资料也会删除。`)) return;
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(store.id)}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "删除店铺失败。");
      await loadStores(state.defaultStoreId === store.id ? "" : state.defaultStoreId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除店铺失败。");
    }
  }

  async function loginStore(store: NoonStore) {
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(store.id)}/login`, { method: "POST" });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "登录任务创建失败。");
      setStatus(`登录任务已启动：${result.id || store.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "登录任务创建失败。");
    }
  }

  async function checkStoreStatus(store = selectedStore) {
    if (!store) {
      setStatus("请先选择 noon 店铺。");
      return;
    }
    try {
      setStatus("正在检测 noon 登录...");
      const response = await fetch(`/api/stores/${encodeURIComponent(store.id)}/status`);
      const result = await response.json() as { uploadPageReachable?: boolean; title?: string; finalUrl?: string; error?: string; status?: string };
      if (!response.ok) throw new Error(result.error || "检测失败。");
      setStatus(result.uploadPageReachable ? `noon 已登录，上传页可达。${result.title || result.finalUrl || ""}` : `noon 未登录或状态未知。${result.finalUrl || result.status || ""}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "检测失败。");
    }
  }

  async function saveStoreToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tokenDialogStore) return;
    const apiToken = tokenValue.trim();
    if (!apiToken) {
      setStatus("API Token 不能为空。");
      return;
    }
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(tokenDialogStore.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiToken }),
      });
      const result = await response.json() as { store?: NoonStore; error?: string };
      if (!response.ok || !result.store) throw new Error(result.error || "保存 API Token 失败。");
      setStatus(`${tokenDialogStore.id} 的 API Token 已保存。`);
      setTokenDialogStore(null);
      setTokenValue("");
      await loadStores(tokenDialogStore.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存 API Token 失败。");
    }
  }

  const stores = useMemo(() => {
    const keyword = storeSearch.trim().toLowerCase();
    if (!keyword) return state.stores;
    return state.stores.filter((store) =>
      [store.id, store.name, store.projectId].some((value) => value.toLowerCase().includes(keyword)),
    );
  }, [state.stores, storeSearch]);

  const selectedStore = state.stores.find((store) => store.id === state.defaultStoreId) || state.stores[0];

  return (
    <>
      <div className="store-layout">
        <section className="settings-panel store-registry-panel" data-store-section="registry">
          <div className="panel-title">
            <span>店铺列表</span>
            <button className="secondary" id="addStoreButton" onClick={() => setDialogOpen(true)} type="button">新增店铺</button>
          </div>
          <p className="setting-hint">维护本机保存的 noon 店铺登录信息，用于后台检测登录和上传时选择店铺。</p>
          <label htmlFor="storeSearch">搜索店铺</label>
          <input id="storeSearch" value={storeSearch} onChange={(event) => setStoreSearch(event.target.value)} placeholder="UAE01 / 店铺名称 / PRJ517205" />
          <div className="store-list" id="storeList">
            {stores.length ? stores.map((store) => {
              const isActive = store.id === state.defaultStoreId;
              return (
                <article className={isActive ? "store-row active" : "store-row"} key={store.id}>
                  <div>
                    <strong>{store.name} · {store.id}</strong>
                    <span>{store.projectId} · {store.hasApiToken ? "API Token 已配置" : "未配置 API Token"} · {store.url}</span>
                  </div>
                  <div className="actions">
                    <button className={isActive ? "ghost" : "secondary"} data-store-default={store.id} disabled={isActive} onClick={() => setDefaultStore(store.id)} type="button">
                      {isActive ? "当前默认" : "设为默认"}
                    </button>
                    <button className="secondary" onClick={() => loginStore(store)} type="button">登录</button>
                    <button className="secondary" onClick={() => checkStoreStatus(store)} type="button">检测</button>
                    <button className="secondary" onClick={() => { setTokenDialogStore(store); setTokenValue(""); }} type="button">设置 API Token</button>
                    <button className="danger" onClick={() => removeStore(store)} type="button">删除</button>
                  </div>
                </article>
              );
            }) : <div className="empty">没有匹配的店铺。</div>}
          </div>
        </section>

        <aside className="settings-panel store-status-panel" data-store-section="status">
          <div className="panel-title"><span>登录状态</span></div>
          <p className="setting-hint">选择店铺后检测 noon 是否已经在对应浏览器资料中保持登录。</p>
          <div className="status-strip" id="noonStatus">
            <strong>{selectedStore ? `${selectedStore.name} · ${selectedStore.id}` : "noon 状态未检测"}</strong>
            <span>{status}</span>
          </div>
          <div className="actions">
            <button className="secondary" id="checkNoonButton" onClick={() => checkStoreStatus()} type="button">检测登录</button>
          </div>
        </aside>
      </div>

      {dialogOpen ? (
        <div className="dialog-backdrop open" id="storeDialog" role="dialog" aria-modal="true" aria-labelledby="storeDialogTitle" onClick={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
          <form className="dialog store-dialog" onSubmit={saveStore}>
            <div className="dialog-head">
              <h2 className="dialog-title" id="storeDialogTitle">新增 noon 店铺</h2>
              <button className="secondary" onClick={() => setDialogOpen(false)} type="button">关闭</button>
            </div>
            <div className="dialog-body">
              <label htmlFor="storeId">店铺 ID</label>
              <input id="storeId" value={form.id} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} placeholder="UAE01" />
              <label htmlFor="storeName">店铺名称</label>
              <input id="storeName" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Main UAE" />
              <label htmlFor="storeProjectId">Project ID</label>
              <input id="storeProjectId" value={form.projectId} onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))} placeholder="PRJ517205" />
              <label htmlFor="storeApiToken">API Token</label>
              <textarea id="storeApiToken" value={form.apiToken} onChange={(event) => setForm((current) => ({ ...current, apiToken: event.target.value }))} placeholder="粘贴 Noon APIJWT JSON 或 Bearer token" rows={5} />
              <div className="actions">
                <button type="submit">保存店铺</button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {tokenDialogStore ? (
        <div className="dialog-backdrop open" id="storeTokenDialog" role="dialog" aria-modal="true" aria-labelledby="storeTokenDialogTitle" onClick={(event) => { if (event.target === event.currentTarget) setTokenDialogStore(null); }}>
          <form className="dialog store-dialog" onSubmit={saveStoreToken}>
            <div className="dialog-head">
              <h2 className="dialog-title" id="storeTokenDialogTitle">设置 API Token · {tokenDialogStore.id}</h2>
              <button className="secondary" onClick={() => setTokenDialogStore(null)} type="button">关闭</button>
            </div>
            <div className="dialog-body">
              <label htmlFor="storeTokenValue">API Token</label>
              <textarea id="storeTokenValue" value={tokenValue} onChange={(event) => setTokenValue(event.target.value)} placeholder="粘贴 Noon APIJWT JSON 或 Bearer token" rows={8} />
              <div className="actions">
                <button type="submit">保存 API Token</button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
