"use client";

export type Market = "AE" | "SA";
export type Tone = "blue" | "cream";

export function MarketBadge({ market }: { market: Market | "GLOBAL" }) {
  return <span className="noon-market-badge">{market}</span>;
}

export function MarketMetric({
  market,
  tone,
  title,
  value,
  lines = [],
  compact = false,
}: {
  market: Market;
  tone: Tone;
  title: string;
  value: string;
  lines?: string[];
  compact?: boolean;
}) {
  return (
    <div className={`noon-market-card ${tone} ${compact ? "compact" : ""}`}>
      <MarketBadge market={market} />
      <div>
        <small>{title}</small>
        <strong>{value}</strong>
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    </div>
  );
}

export function MarketSource({
  market,
  text = "未关联 Noon 大师货源",
}: {
  market: Market;
  text?: string;
}) {
  return (
    <div className="noon-source-card">
      <MarketBadge market={market} />
      <strong>{text}</strong>
    </div>
  );
}

export function OfferStatus({
  market,
  status = "下线",
  reason = "卖家停用",
  code = "no_offer",
}: {
  market: Market;
  status?: string;
  reason?: string;
  code?: string;
}) {
  return (
    <div className="noon-offer-card">
      <MarketBadge market={market} />
      <strong>{status}</strong>
      <b>{reason}</b>
      <em>{code}</em>
    </div>
  );
}

export function GlobalCard({ text = "暂无数据" }: { text?: string }) {
  return (
    <div className="noon-global-card">
      <span>GLOBAL</span>
      <b>{text}</b>
    </div>
  );
}
