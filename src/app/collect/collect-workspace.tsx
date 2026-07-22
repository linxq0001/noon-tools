"use client";

import { FormEvent, useEffect, useState } from "react";

type JobLog = { time: string; line: string };
type Job = {
  id: string;
  kind: string;
  status: string;
  url: string;
  logs: JobLog[];
};

type CollectForm = {
  url: string;
  repository: string;
  limit: string;
  delaySeconds: string;
  headless: string;
  proxy: string;
  deepSeekApiKey: string;
  deepSeekModel: string;
};

const emptyJob: Job = { id: "", kind: "", status: "Idle", url: "", logs: [] };

export default function CollectWorkspace() {
  const [form, setForm] = useState<CollectForm>({
    url: "",
    repository: "",
    limit: "0",
    delaySeconds: "30",
    headless: "true",
    proxy: "",
    deepSeekApiKey: "",
    deepSeekModel: "deepseek-v4-flash",
  });
  const [job, setJob] = useState<Job>(emptyJob);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((response) => response.json())
      .then((settings: Partial<CollectForm>) => {
        setForm((current) => ({
          ...current,
          url: settings.url || current.url,
          repository: settings.repository || current.repository,
          limit: settings.limit || current.limit,
          delaySeconds: settings.delaySeconds || current.delaySeconds,
          headless: settings.headless || current.headless,
          proxy: settings.proxy || current.proxy,
          deepSeekApiKey: settings.deepSeekApiKey || current.deepSeekApiKey,
          deepSeekModel: settings.deepSeekModel || current.deepSeekModel,
        }));
      })
      .catch(() => setMessage("配置读取失败，仍可手动填写后启动。"));
  }, []);

  useEffect(() => {
    if (!job.id || job.status !== "running") return;
    const timer = setInterval(async () => {
      try {
        const nextJob = await fetchJob(job.id);
        setJob(nextJob);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "读取任务失败。");
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [job.id, job.status]);

  const running = job.status === "running";

  async function startCollect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: form.url.trim(),
        limit: Number(form.limit === "" ? 0 : form.limit),
        delaySeconds: Number(form.delaySeconds || 30),
        headless: form.headless !== "false",
        proxy: form.proxy.trim(),
        repository: form.repository.trim(),
        deepSeekApiKey: form.deepSeekApiKey.trim(),
        deepSeekModel: form.deepSeekModel || "deepseek-v4-flash",
      }),
    });
    await handleJobResponse(response, "任务创建失败");
  }

  async function login1688() {
    setMessage("");
    const response = await fetch("/api/login-1688", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: form.url.trim() }),
    });
    await handleJobResponse(response, "登录任务创建失败");
  }

  async function stopJob() {
    if (!job.id) return;
    const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST" });
    await handleJobResponse(response, "停止任务失败");
  }

  async function handleJobResponse(response: Response, fallback: string) {
    const result = await response.json() as Job & { error?: string };
    if (!response.ok) {
      setMessage(result.error || fallback);
      return;
    }
    setJob(result);
  }

  return (
    <form className="form-grid" onSubmit={startCollect}>
      <section className="settings-panel pad">
        <div className="panel-title"><span>采集来源</span></div>
        <label htmlFor="url">1688 链接</label>
        <input id="url" name="url" value={form.url} onChange={(event) => updateForm("url", event.target.value)} placeholder="https://detail.1688.com/offer/..." />

        <label htmlFor="repository">仓库名称</label>
        <input id="repository" name="repository" value={form.repository} onChange={(event) => updateForm("repository", event.target.value)} placeholder="列表页采集时使用；留空自动命名" />

        <div className="grid-2">
          <div>
            <label htmlFor="limit">本次商品数量</label>
            <input id="limit" name="limit" type="number" min="0" max="100" value={form.limit} onChange={(event) => updateForm("limit", event.target.value)} />
          </div>
          <div>
            <label htmlFor="delaySeconds">详情间隔秒数</label>
            <input id="delaySeconds" name="delaySeconds" type="number" min="0" max="300" value={form.delaySeconds} onChange={(event) => updateForm("delaySeconds", event.target.value)} />
          </div>
        </div>

        <div className="grid-2">
          <div>
            <label htmlFor="headless">1688 浏览器运行方式</label>
            <select id="headless" name="headless" value={form.headless} onChange={(event) => updateForm("headless", event.target.value)}>
              <option value="false">显示窗口</option>
              <option value="true">后台运行</option>
            </select>
          </div>
          <div>
            <label htmlFor="proxy">Proxy</label>
            <input id="proxy" name="proxy" value={form.proxy} onChange={(event) => updateForm("proxy", event.target.value)} placeholder="http://user:pass@host:port" />
          </div>
        </div>
      </section>

      <aside className="settings-panel pad">
        <div className="panel-title"><span>采集作业</span><strong id="jobStatus">{job.status}</strong></div>
        <div className="actions">
          <button id="submitButton" disabled={running} type="submit">开始采集</button>
          <button className="secondary" id="login1688Button" disabled={running} onClick={login1688} type="button">登录1688</button>
        </div>

        <div className="panel-title collect-log-title"><span>采集日志</span></div>
        <div className="actions">
          <button className="secondary" id="collectStopButton" disabled={!running} onClick={stopJob} type="button">停止任务</button>
          <button className="secondary" id="clearCollectLogButton" onClick={() => setJob((current) => ({ ...current, logs: [] }))} type="button">清空日志</button>
        </div>
        {message ? <p className="setting-hint">{message}</p> : null}
        <div className="panel log" id="collectLog">
          {job.logs.map((item) => <div key={`${item.time}-${item.line}`}>{item.line}</div>)}
        </div>
      </aside>
    </form>
  );

  function updateForm(name: keyof CollectForm, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }
}

async function fetchJob(id: string) {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
  const result = await response.json() as Job & { error?: string };
  if (!response.ok) throw new Error(result.error || "读取任务失败。");
  return result;
}
