"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type UploadJob = {
  id: string;
  kind: string;
  status: "running" | "completed" | "failed" | "cancelled";
  url: string;
  repository?: string;
  productDir?: string;
  productDirs?: string[];
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  logs: Array<{ time: string; line: string }>;
};

export default function UploadJobsWorkspace() {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const searchParams = useSearchParams();
  const initialJobId = searchParams.get("jobId");
  const [selectedId, setSelectedId] = useState<string | null>(initialJobId);
  const [status, setStatus] = useState("读取中...");

  const refreshJobs = async () => {
    try {
      const response = await fetch("/api/upload-jobs");
      const result = (await response.json()) as UploadJob[];
      if (!Array.isArray(result)) throw new Error("任务列表格式错误。");
      setJobs(result);
      setStatus("");
      return result;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取任务失败。");
      return [];
    }
  };

  useEffect(() => {
    refreshJobs();
  }, []);

  useEffect(() => {
    const timer = setInterval(refreshJobs, 2000);
    return () => clearInterval(timer);
  }, []);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedId) || jobs.find((job) => job.id === initialJobId) || jobs[0] || null,
    [jobs, selectedId, initialJobId],
  );


  async function stopJob(id: string) {
    const response = await fetch(`/api/upload-jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    const result = (await response.json()) as UploadJob & { error?: string };
    if (!response.ok) {
      setStatus(result.error || "停止任务失败。");
      return;
    }
    await refreshJobs();
    setStatus(`任务已停止：${result.id}`);
  }

  function clearSelection() {
    setSelectedId(null);
  }

  return (
    <section className="upload-jobs-workspace">
      <div className="upload-jobs-grid">
        <div className="upload-jobs-list">
          <div className="upload-jobs-list-head">
            <span>任务</span>
            <span>状态</span>
            <span>启动时间</span>
            <span>操作</span>
          </div>
          {jobs.length === 0 ? (
            <div className="upload-jobs-empty">暂无上传任务</div>
          ) : (
            jobs.map((job) => (
              <button
                className={selectedJob?.id === job.id ? "upload-jobs-row active" : "upload-jobs-row"}
                key={job.id}
                onClick={() => setSelectedId(job.id)}
                type="button"
              >
                <span className="upload-jobs-id">{job.id}</span>
                <span className={`upload-jobs-status upload-jobs-status-${job.status}`}>{formatJobStatus(job.status)}</span>
                <span>{new Date(job.startedAt).toLocaleString()}</span>
                <span className="upload-jobs-actions">
                  {job.status === "running" ? (
                    <button
                      className="secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        stopJob(job.id);
                      }}
                      type="button"
                    >
                      停止
                    </button>
                  ) : null}
                </span>
              </button>
            ))
          )}
        </div>

        <aside className="upload-jobs-log-panel">
          <div className="product-job-head">
            <div>
              <span>noon 上传作业</span>
              <strong>{selectedJob ? `任务 ${selectedJob.id}` : "未选择任务"}</strong>
            </div>
            <div className="actions">
              {selectedJob?.status === "running" ? (
                <button className="secondary" onClick={() => stopJob(selectedJob.id)} type="button">
                  停止任务
                </button>
              ) : null}
              {selectedJob ? (
                <button className="secondary" onClick={clearSelection} type="button">
                  清空选择
                </button>
              ) : null}
            </div>
          </div>
          <div className="panel log" id="uploadJobLog">
            {selectedJob?.logs.length ? (
              selectedJob.logs.map((item, index) => <div key={`${index}-${item.line}`}>{item.line}</div>)
            ) : (
              <div className="log-empty">{selectedJob ? "等待任务输出..." : "点击左侧任务查看日志"}</div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function formatJobStatus(status: string) {
  if (status === "running") return "运行中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已停止";
  return status;
}
