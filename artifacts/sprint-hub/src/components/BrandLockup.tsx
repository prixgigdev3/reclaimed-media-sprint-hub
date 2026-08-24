import reclaimedWordmark from "@/assets/reclaimed-media-wordmark-blue.png";
import { BRAND_NAME } from "@/lib/brand";

// Brand lockup: the script wordmark (Symphony-style lettering, brand blue
// #4451a0). Used across both AdminLayout and ClientLayout (mobile top bar,
// mobile drawer, desktop sidebar) so the brand reads identically in every
// signed-in surface.
export function BrandLockup({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const imgClass = size === "sm" ? "h-7" : size === "lg" ? "h-11" : "h-9";
  return (
    <div className="flex items-center">
      <img
        src={reclaimedWordmark}
        alt={BRAND_NAME}
        className={`${imgClass} w-auto object-contain shrink-0`}
      />
    </div>
  );
}
