import CollectWorkspace from "./collect-workspace";

export default function CollectPage() {
  return (
    <main className="page-shell">
      <div className="page-head">
        <div>
          <p className="page-kicker">1688</p>
          <h1 className="page-title">采集任务</h1>
        </div>
      </div>
      <CollectWorkspace />
    </main>
  );
}
