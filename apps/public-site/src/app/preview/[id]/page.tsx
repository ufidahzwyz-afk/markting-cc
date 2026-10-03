import { notFound } from "next/navigation";
import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
/** Draft preview is exposed only by the authenticated ops API. No public identity escalation. */
export default function Preview() { notFound(); }
