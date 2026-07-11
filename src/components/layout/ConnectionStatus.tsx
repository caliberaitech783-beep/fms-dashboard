import { Database, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { getPendingOperations, subscribeOfflineQueue } from "../../pwa/offlineQueue";
import { activeDataSource } from "../../services/adapters";
import { Badge } from "../ui/Badge";

export function ConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(getPendingOperations().length);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    const unsubscribe = subscribeOfflineQueue((operations) => setPendingCount(operations.length));

    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      unsubscribe();
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={online ? "good" : "danger"}>
        <span className="inline-flex items-center gap-1">
          {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {online ? "Online" : "Offline"}
        </span>
      </Badge>
      <Badge tone="warning">
        <Database className="h-3 w-3" />
        {activeDataSource.label} · as of {formatDataDate(activeDataSource.asOf)}
      </Badge>
      {pendingCount > 0 && <Badge tone="warning">{pendingCount} local changes pending</Badge>}
    </div>
  );
}

function formatDataDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${value}T00:00:00`));
}
