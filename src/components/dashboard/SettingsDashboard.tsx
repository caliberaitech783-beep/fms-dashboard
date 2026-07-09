import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";

export function SettingsDashboard() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Settings Placeholder" subtitle="Phase 2 can add role-based permissions, audit controls, source credentials, and notification rules.">
        <div className="space-y-3 text-sm">
          <SettingRow label="Manual edits audit logging" status="queued" detail="Trip, production, and fuel edits will write actor, timestamp, previous value, and reason." />
          <SettingRow label="Offline threshold" status="ready" detail="Configured in constants/thresholds.ts and used by alert generation." />
          <SettingRow label="OEM credential storage" status="queued" detail="Use environment variables and backend secret storage before real API rollout." />
          <SettingRow label="WhatsApp Business API" status="queued" detail="Service placeholders and .env.example keys are already present." />
        </div>
      </Panel>
      <Panel title="Phase 2 Backlog">
        <ul className="space-y-3 text-sm text-coal-700">
          <li>Real OEM/tracker adapters with retry, rate-limit, and field mapping tests.</li>
          <li>Persisted report generation with PDF and Excel renderers.</li>
          <li>Authenticated users, roles, and action audit trails.</li>
          <li>CRUD screens for all master data tabs.</li>
        </ul>
      </Panel>
    </div>
  );
}

function SettingRow({ label, status, detail }: { label: string; status: string; detail: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-coal-200 p-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="font-semibold text-coal-900">{label}</p>
        <p className="mt-1 text-coal-500">{detail}</p>
      </div>
      <StatusBadge status={status} />
    </div>
  );
}
