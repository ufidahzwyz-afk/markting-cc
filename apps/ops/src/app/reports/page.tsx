import type { Metadata } from "next";
import { ReportsWorkspace } from "@/components/reports-workspace";

export const metadata: Metadata = { title: "效果复盘" };

export default function ReportsPage() {
  return <ReportsWorkspace />;
}
