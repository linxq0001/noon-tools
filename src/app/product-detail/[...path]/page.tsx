import Link from "next/link";
import { readProductDetail } from "@/lib/products";

type PageProps = {
  params: Promise<{ path: string[] }>;
};

export default async function ProductDetailPage({ params }: PageProps) {
  const { path } = await params;
  const detail = await readProductDetail(path.join("/"));

  if (!detail) {
    return (
      <main className="page-shell product-page-shell">
        <Link className="secondary detail-back-link" href="/repositories">返回商品仓库</Link>
        <div className="empty">找不到商品详情。</div>
      </main>
    );
  }

  const group = detail.product_group;
  const variants = detail.variants;
  const images = [...new Set([
    ...imagesFrom(group.images),
    ...variants.flatMap((variant) => imagesFrom(variant.images)),
  ])].slice(0, 9);
  const firstVariant = variants[0] || {};
  const bullets = firstArray(group.feature_bullets_en).length
    ? firstArray(group.feature_bullets_en)
    : firstArray(firstVariant.bullets);

  return (
    <main className="page-shell product-page-shell">
      <div className="detail-page-toolbar">
        <div className="detail-toolbar-primary">
          <Link className="secondary detail-back-link" href="/repositories">返回</Link>
          <div>
            <p>Product Detail</p>
            <h1>{detail.title}</h1>
          </div>
          <span className="detail-save-pill">完整 Noon 属性</span>
        </div>
      </div>

      <section className="detail-data-notice">
        <strong>新旧数据对齐</strong>
        <span>{detail.dataNotice}</span>
      </section>

      <section className="detail-product-layout">
        <section className="detail-product-editor">
          <div className="detail-editor-title"><h3>商品信息</h3></div>
          <div className="detail-form-row">
            <div className="detail-form-label">
              <span>* 商品标题 (英文)</span>
              <span className="detail-badge">product_group</span>
            </div>
            <div className="detail-read-field">{display(group.product_group_name_en || group.title_en || detail.title)}</div>
            <div className="detail-helper-strip">
              <span>完整 variants：{variants.length}</span>
              <span>原始目录：{detail.dirName}</span>
            </div>
          </div>

          <section className="detail-field-grid">
            <DetailField label="品类" value={group.category || group.category_path || group.type} />
            <DetailField label="* 品牌" value={group.brand || "No Brand"} />
            <DetailField label="人群" value={group.gender || group.target_gender} />
            <DetailField label="* 商品状况" value={group.item_condition || group.condition || "New"} />
            <DetailField label="HS Code" value={group.hs_code || group.hsCode || group.hsn_code} />
            <DetailField label="库存 / 时效" value={`${display(firstVariant.stock)} / ${display(firstVariant.processingTime)}`} />
          </section>
        </section>

        <section className="detail-section-card">
          <h3>卖点特征</h3>
          {bullets.length ? (
            <ol className="detail-bullet-list">
              {bullets.slice(0, 5).map((bullet, index) => (
                <li key={`${index}-${bullet}`}>
                  <span className="detail-bullet-index">{index + 1}</span>
                  <div className="detail-read-field">{bullet}</div>
                </li>
              ))}
            </ol>
          ) : <div className="empty">没有卖点特征。</div>}
        </section>

        <section className="detail-section-card">
          <h3>商品描述</h3>
          <div className="detail-read-area">{display(group.description_en || firstVariant.description)}</div>
        </section>

        <section className="detail-section-card">
          <div className="detail-editor-title">
            <h3>商品图片</h3>
            <span className="detail-badge">已选 {images.length} / 9</span>
          </div>
          {images.length ? (
            <div className="detail-image-grid">
              {images.map((image, index) => (
                <a className="detail-image-tile" href={image} key={image} target="_blank">
                  <img alt="" src={image} />
                  <span>{index === 0 ? "首图" : index + 1}</span>
                </a>
              ))}
            </div>
          ) : <div className="empty">没有商品图片。</div>}
        </section>

        <section className="detail-section-card detail-sku-card">
          <div className="detail-editor-title">
            <h3>SKU 变体详情</h3>
            <span className="meta">{variants.length} 个 variants</span>
          </div>
          {variants.length ? <VariantTable variants={variants} /> : <div className="empty">没有 variants 信息。</div>}
        </section>
      </section>
    </main>
  );
}

function DetailField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="detail-field">
      <span>{label}</span>
      <strong>{display(value)}</strong>
    </div>
  );
}

function VariantTable({ variants }: { variants: Array<Record<string, unknown>> }) {
  return (
    <div className="variant-group-table-wrap">
      <table className="variant-group-table">
        <thead>
          <tr>
            <th>成本价</th>
            <th>分组</th>
            <th>SKU变体</th>
            <th>PSKU</th>
            <th>建议售价</th>
            <th>库存</th>
            <th>尺寸/重量</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((variant, index) => (
            <tr key={String(variant.id || index)}>
              <td>{display(variant.priceUsd || "-")}</td>
              <td>{display(variant.colour || "默认分组")}</td>
              <td>{display(variant.title)}</td>
              <td>{display(variant.partnerSku || variant.modelNumber)}<span className="variant-table-muted">Barcode: {display(variant.barcode)}</span></td>
              <td>{display(variant.priceSarInitial)}</td>
              <td>{display(variant.stock)} 件</td>
              <td>{display(variant.sizeText)}<span className="variant-table-muted">重量 {display(variant.weightKg)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function display(value: unknown) {
  return value === null || value === undefined || String(value).trim() === "" ? "-" : String(value);
}

function firstArray(value: unknown) {
  return (Array.isArray(value) ? value : [value]).map(display).filter((item) => item !== "-");
}

function imagesFrom(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
