"use client";
import { useActionState, useState } from "react";
import { Button, Field, inputCls } from "@/components/ui";
import { slugify } from "@/lib/auth/slug";
import { createTenantAction, type OnboardingState } from "./actions";

const ERR: Record<NonNullable<OnboardingState["error"]>, string> = {
  name: "onb.errName", slug_format: "onb.errSlugFormat", slug_taken: "onb.errSlug", limit: "onb.errLimit", failed: "onb.errFailed",
};

export function OnboardingForm({ labels }: { labels: Record<string, string> }) {
  const [state, action, pending] = useActionState(createTenantAction, {});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const shownSlug = slugEdited ? slug : name.trim() ? slugify(name) : "";
  return (
    <form action={action} className="space-y-4">
      <Field label={labels["onb.name"]}>
        <input name="name" required autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <Field label={labels["onb.slug"]} hint={labels["onb.slugHint"]}>
        <input name="slug" required minLength={2} maxLength={63} value={shownSlug}
          onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase()); }} className={inputCls} autoCapitalize="none" spellCheck={false} />
      </Field>
      {state.error && <p role="alert" className="text-sm text-danger">{labels[ERR[state.error]]}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{labels["onb.submit"]}</Button>
    </form>
  );
}
