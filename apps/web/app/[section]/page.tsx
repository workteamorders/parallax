import { notFound } from "next/navigation";
import { Observatory } from "@/components/observatory";
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!["markets", "signals", "portfolio", "alerts"].includes(section))
    notFound();
  return <Observatory page={section} />;
}
