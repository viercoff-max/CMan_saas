"use client";
import { useActionState, useState } from "react";
import { Button, Field, inputCls } from "@/components/ui";
import { createDemoBusinessAction, type DemoState } from "./actions";

export interface TemplateOption { key: string; title: string; body: string; defaultName: string }

export function DemoForm({ templates, labels }: { templates: TemplateOption[]; labels: Record<string, string> }) {
  const [state, action, pending] = useActionState<DemoState, FormData>(createDemoBusinessAction, {});
  const [tpl, setTpl] = useState(templates[0]?.key ?? "");
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(templates.map((t) => [t.key, t.defaultName])));
  return (
    <form action={action} className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">{labels["demo.pick"]}</legend>
        <div className="grid gap-3">
          {templates.map((t) => (
            <label key={t.key} className={`flex min-h-11 cursor-pointer gap-3 rounded-xl border p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/50 ${tpl === t.key ? "border-brand bg-brand/5" : "border-line hover:border-brand/50"}`}>
              <input type="radio" name="template" value={t.key} checked={tpl === t.key} onChange={() => setTpl(t.key)} className="mt-1 h-4 w-4 accent-brand" />
              <span>
                <span className="block text-sm font-semibold text-ink">{t.title}</span>
                <span className="block text-sm text-muted">{t.body}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={labels["demo.name"]} hint={labels["demo.nameHint"]}>
        <input name="name" required maxLength={120} value={names[tpl] ?? ""} className={inputCls}
          onChange={(e) => setNames((n) => ({ ...n, [tpl]: e.target.value }))} />
      </Field>
      {state.error && <p role="alert" className="text-sm text-danger">{labels[`demo.err.${state.error}`]}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? labels["demo.creating"] : labels["demo.submit"]}</Button>
    </form>
  );
}
