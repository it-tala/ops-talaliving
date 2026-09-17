"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { procurement } from "@/demo/api";
import { VendorBlock } from "../VendorBlock";

/** One supplier, full width (D103).
 *
 *  The alternative was a detail panel beside the list or a row that expands
 *  under it. Both lose: a vendor's story is three stacked tables — orders,
 *  deliveries, payments — and each of them is naturally wide, so a side panel
 *  turns every one of them into a horizontal scroll on the laptops this is
 *  actually read on. A page of its own also gives the vendor a URL somebody
 *  can paste into chat, which is how half of these questions arrive.
 */
export default function VendorTrackerPage({ params }: { params: Promise<{ vendor: string }> }) {
  /* Next 15 hands route params to the page as a promise, so it can start
     rendering before the segment is resolved. `use` unwraps it here — the
     rest of the component reads the same plain string it always did. */
  const { vendor } = use(params);
  const [journey, reload] = useLoad(() => procurement.getVendorJourney(vendor), [vendor]);

  return (
    <div>
      <Link
        href="/procurement/tracker"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All suppliers
      </Link>

      <Loaded state={journey} onRetry={reload}>
        {(v) => (
          <>
            <PageHeader
              breadcrumb="Purchase tracker"
              title={v.vendor_name}
              description={v.headline}
              actions={<SourceBadge state={journey} />}
            />
            <VendorBlock journey={v} onChanged={reload} />
          </>
        )}
      </Loaded>
    </div>
  );
}
