import type { ReactNode } from "react";
import { Panel } from "../ui/Panel";

interface ChartFrameProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  height?: number;
}

export function ChartFrame({ title, subtitle, children, height = 288 }: ChartFrameProps) {
  return (
    <Panel title={title} subtitle={subtitle}>
      <div className="w-full" style={{ height }}>{children}</div>
    </Panel>
  );
}
