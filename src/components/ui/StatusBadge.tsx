import { Badge, statusTone } from "./Badge";
import { titleCase } from "../../utils/formatters";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <Badge tone={statusTone(status)}>{titleCase(status)}</Badge>;
}
