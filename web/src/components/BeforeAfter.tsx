import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";
import { captureTime, fmtDate } from "../lib/format";
import type { Evidence } from "../lib/types";

export default function BeforeAfter({ before, after }: { before: Evidence; after: Evidence }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-stone-900 ring-1 ring-stone-200">
      <ReactCompareSlider
        itemOne={<ReactCompareSliderImage src={before.views?.slider} alt="Before" style={{ aspectRatio: "3 / 2" }} />}
        itemTwo={<ReactCompareSliderImage src={after.views?.slider} alt="After" style={{ aspectRatio: "3 / 2" }} />}
      />
      <span className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md bg-black/65 px-2 py-1 text-xs font-semibold text-white">
        BEFORE · {fmtDate(captureTime(before))}
      </span>
      <span className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-md bg-black/65 px-2 py-1 text-xs font-semibold text-white">
        AFTER · {fmtDate(captureTime(after))}
      </span>
    </div>
  );
}
