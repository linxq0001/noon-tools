import RepositoriesWorkspace from "./repositories-workspace";

export default function RepositoriesPage() {
  return (
    <main className="page-shell product-page-shell repository-page-shell">
      <div className="page-head">
        <div>
          <p className="page-kicker">Products</p>
          <h1 className="page-title">待上架商品</h1>
        </div>
      </div>
      <RepositoriesWorkspace />
    </main>
  );
}
