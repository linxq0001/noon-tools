import StoresWorkspace from "./stores-workspace";

export default function StoresPage() {
  return (
    <main className="page-shell">
      <div className="page-head store-page-head">
        <div>
          <p className="page-kicker">Noon Stores</p>
          <h1 className="page-title">Noon 店铺管理</h1>
        </div>
      </div>
      <StoresWorkspace />
    </main>
  );
}
