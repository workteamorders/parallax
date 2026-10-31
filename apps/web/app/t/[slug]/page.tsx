import { Observatory } from "@/components/observatory";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <Observatory page="theme" slug={(await params).slug} />;
}
