import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { getPendingOperations, subscribeOfflineQueue } from "../../pwa/offlineQueue";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

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
      <Badge tone={pendingCount ? "warning" : "info"}>{pendingCount ? `${pendingCount} pending sync` : "Synced"}</Badge>
      {pendingCount > 0 && (
        <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => window.dispatchEvent(new CustomEvent("cmll:fms-retry-sync"))}>
          Retry
        </Button>
      )}
    </div>
  );
}
