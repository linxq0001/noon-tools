import { Suspense } from "react";
import UploadJobsWorkspace from "./upload-jobs-workspace";

export default function UploadJobsPage() {
  return (
    <main className="page-shell product-page-shell upload-jobs-page-shell">
      <div className="page-head">
        <div>
          <p className="page-kicker">Jobs</p>
          <h1 className="page-title">上传任务日志</h1>
        </div>
      </div>
      <Suspense fallback={<div className="setting-hint">加载中...</div>}>
        <UploadJobsWorkspace />
      </Suspense>
    </main>
  );
}
