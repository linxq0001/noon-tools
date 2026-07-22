import {
  WorkbenchCardInner,
  WorkbenchCardLink,
  WorkbenchHeader,
} from "@/components/workbench/workbench-home";

export default function HomePage() {
  return (
    <main className="wb-page">
      <div className="wb-scanlines" aria-hidden />
      <div className="wb-inner">
        <header className="wb-head">
          <WorkbenchHeader />
        </header>

        <section className="wb-grid" aria-label="模块入口">
          <WorkbenchCardLink href="/collect" revealDelay={320}>
            <WorkbenchCardInner
              index="01"
              name="1688 采集"
              desc="启动采集、登录 1688，并查看本地任务日志。"
              tag="COLLECT"
            />
          </WorkbenchCardLink>
          <WorkbenchCardLink href="/repositories" revealDelay={390}>
            <WorkbenchCardInner
              index="02"
              name="商品仓库"
              desc="浏览仓库商品，支持搜索和分页。"
              tag="REPOSITORY"
            />
          </WorkbenchCardLink>
          <WorkbenchCardLink href="/stores" revealDelay={460}>
            <WorkbenchCardInner
              index="03"
              name="店铺"
              desc="维护 Noon 店铺、默认店铺和本机登录资料。"
              tag="STORES"
            />
          </WorkbenchCardLink>
          <WorkbenchCardLink href="/noon-workbench" revealDelay={530}>
            <WorkbenchCardInner
              index="04"
              name="Noon 工作台"
              desc="集中处理检查、上架、停售和 Global 批量更新表。"
              tag="OPERATIONS"
            />
          </WorkbenchCardLink>
          <WorkbenchCardLink href="/settings" revealDelay={600}>
            <WorkbenchCardInner
              index="05"
              name="配置"
              desc="第一阶段迁移的设置读写链路。"
              tag="SETTINGS"
            />
          </WorkbenchCardLink>
          <WorkbenchCardLink href="http://localhost:4173" external revealDelay={670}>
            <WorkbenchCardInner
              index="06"
              name="旧工作台"
              desc="采集、仓库、上传和 Noon 工作台仍在旧 UI。"
              tag="LEGACY"
              external
            />
          </WorkbenchCardLink>
        </section>
      </div>
    </main>
  );
}
