// Marca (admin only): logo, display name, colours, heading font, live preview and AA contrast report (mockup 11).
import { PageHeader } from "@/components/ui";
import { requireAdminPage } from "@/components/guards";
import { getLocale, makeT } from "@/lib/i18n";
import { getData } from "@/lib/data";
import { logoUrl } from "@/lib/storage/logo";
import { BrandForm } from "./BrandForm";
import { brandDict } from "./dict";

export const dynamic = "force-dynamic";

export default async function BrandPage() {
  const s = await requireAdminPage(); // agents are redirected to /inbox before anything renders
  const t = makeT(brandDict, await getLocale());
  const b = await getData().brand.get(s.tenantId);
  const tenantName = s.tenants.find((x) => x.id === s.tenantId)?.name ?? "";
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <BrandForm initial={{
        displayName: b.displayName || tenantName, primaryColor: b.primaryColor.toUpperCase(), accentColor: b.accentColor.toUpperCase(),
        menuBgColor: b.menuBgColor.toUpperCase(), headingFont: b.headingFont, logoUrl: logoUrl(s.tenantId, b.logoPath),
      }} />
    </>
  );
}
