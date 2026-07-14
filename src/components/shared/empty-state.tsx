import Image from "next/image";
import { Button } from "@/components/ui/button";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <Image
        src="/studyforge-hero.png"
        alt=""
        width={220}
        height={140}
        className="mb-4 h-28 w-44 rounded-lg object-cover opacity-90"
      />
      <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-slate-600">{body}</p>
      {action ? <div className="mt-5">{action}</div> : <Button className="mt-5">Start</Button>}
    </div>
  );
}
