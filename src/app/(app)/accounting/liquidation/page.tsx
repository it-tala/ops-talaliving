"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** The liquidation report lives on `/accounting/ringkasan` now (L9, kajian
 *  §6.8), as one tab among the summaries leadership reads. Old links land
 *  here and go on to it. */
export default function LiquidationPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/accounting/ringkasan?tab=likuidasi"); }, [router]);
  return null;
}
