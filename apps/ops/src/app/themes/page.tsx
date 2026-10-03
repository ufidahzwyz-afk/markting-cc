import type { Metadata } from "next";
import { ThemesWorkspace } from "@/components/themes-workspace";

export const metadata: Metadata = { title: "推广主题" };

export default function ThemesPage() {
  return <ThemesWorkspace />;
}
