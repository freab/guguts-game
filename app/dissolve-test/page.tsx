"use client";
import DissolveCanvas from "../ui/DissolveCanvas";
export default function Page() {
  return <div className="fixed inset-0"><DissolveCanvas fromSrc="/preloader/first.webp" toSrc="/preloader/second.webp" stage={0} /></div>;
}
