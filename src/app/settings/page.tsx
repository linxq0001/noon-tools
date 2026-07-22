import SettingsForm from "./settings-form";

export default function SettingsPage() {
  return (
    <main className="page-shell">
      <div className="page-head">
        <div>
          <p className="page-kicker">Configuration</p>
          <h1 className="page-title">配置</h1>
        </div>
      </div>
      <SettingsForm />
    </main>
  );
}
