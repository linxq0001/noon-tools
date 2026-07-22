"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { index: "01", label: "工作台", href: "/" },
  { index: "02", label: "1688 采集", href: "/collect" },
  { index: "03", label: "商品仓库", href: "/repositories" },
  { index: "04", label: "上传日志", href: "/upload-jobs" },
  { index: "05", label: "Noon 工作台", href: "/noon-workbench" },
  { index: "06", label: "店铺", href: "/stores" },
  { index: "07", label: "配置", href: "/settings" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const shellClassName = pathname === "/noon-workbench" ? "shell noon-legacy-shell" : "shell";

  return (
    <main className={shellClassName}>
      <aside className="rail">
        <div className="brand">
          <h1>Noon Tools</h1>
          <span>1688 collection workspace</span>
        </div>
        <nav className="nav" aria-label="业务导航">
          {navItems.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link className={active ? "active" : ""} href={item.href} key={item.href}>
                <span>{item.index}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="rail-status">
          <span>任务状态</span>
          <strong id="jobStatus">Idle</strong>
        </div>
      </aside>
      <section className="content">{children}</section>
    </main>
  );
}
