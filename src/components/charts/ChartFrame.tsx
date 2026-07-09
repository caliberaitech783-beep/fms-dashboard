import type { ReactNode } from "react";
import { Panel } from "../ui/Panel";

interface ChartFrameProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function ChartFrame({ title, subtitle, children }: ChartFrameProps) {
  return (
    <Panel title={title} subtitle={subtitle}>
      <div className="h-72 w-full">{children}</div>
    </Panel>
  );
}
