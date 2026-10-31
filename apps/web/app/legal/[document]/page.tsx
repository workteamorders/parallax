import { notFound } from "next/navigation";
import { Observatory } from "@/components/observatory";
export default async function Page({
  params,
}: {
  params: Promise<{ document: string }>;
}) {
  const { document } = await params;
  if (!["terms", "privacy", "risk"].includes(document)) notFound();
  return <Observatory page="legal" slug={document} />;
}
