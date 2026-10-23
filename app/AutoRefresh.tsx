"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-render the board every `seconds`, and as soon as the page comes back on screen. */
export default function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    const onShow = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onShow); };
  }, [router, seconds]);
  return null;
}
