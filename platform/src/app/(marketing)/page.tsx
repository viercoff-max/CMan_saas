// "/" public landing (proposal B, design/landing-2026): customer support for small, mid-size and large companies.
// Signed-in users go straight to the app (/dashboard; the app layout sends a user without a business on to
// /onboarding). Copy and channel states come from lib/platform/content.ts and channels.ts (single sources).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { contactEmail } from "@/lib/platform/brand";
import { CHANNEL_AVAILABILITY } from "@/lib/platform/channels";
import { landing, type LandingState } from "@/lib/platform/content";
import { publicMetadata } from "@/lib/platform/seo";
import s from "./landing.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const c = landing[await getLocale()];
  return publicMetadata({ title: c.metaTitle, description: c.metaDescription });
}

async function isSignedIn(): Promise<boolean> {
  try { return (await getAuthState()).status !== "anonymous"; }
  catch { return false; } // auth backend not configured: show the public page
}

const CH_LETTER: Record<string, string> = { telegram: "T", whatsapp: "W", instagram: "I", messenger: "M", email: "@" };
const STATE_CLS: Record<LandingState, string> = { bot: s.stBot, team: s.stTeam, done: s.stDone };
const GLYPH = ["var(--lila)", "var(--mango)", "var(--ink)", "var(--brand)", "var(--jade)", "var(--surface)"];

function Ch({ id }: { id: string }) {
  return <span aria-hidden="true" className={`${s.ch} ${s[`ch_${id}`] ?? ""}`}>{CH_LETTER[id] ?? "?"}</span>;
}

function SecondaryCta({ href, label, mail, light = false }: { href: string; label: string; mail: boolean; light?: boolean }) {
  const cls = `${s.btn} ${light ? s.btnLine : s.btnGhost}`;
  return mail ? <a href={href} className={cls}>{label}</a> : <Link href={href} className={cls}>{label}</Link>;
}

export default async function LandingPage() {
  if (await isSignedIn()) redirect("/dashboard");
  const locale = await getLocale();
  const c = landing[locale];
  // "Talk to sales" only when there is somewhere to write to; until then the secondary action is the plans page.
  const sales = contactEmail();
  const second = sales
    ? { href: `mailto:${sales}?subject=${encodeURIComponent(c.ctaSales)}`, label: c.ctaSales, mail: true }
    : { href: "/precios", label: c.ctaPlans, mail: false };

  return (
    <>
      <div className={s.wrap}>
        <section className={s.hero} aria-labelledby="hero-title">
          <div>
            <p className={`${s.kicker} ${s.r1}`}><i aria-hidden="true" />{c.kicker}</p>
            <h1 id="hero-title" className={`${s.title} ${s.display} ${s.r2}`}>
              {c.titleBefore} <span className={s.sticker}>{c.time}</span>
            </h1>
            <p className={`${s.lead} ${s.r3}`}>{c.lead}</p>
            <div className={`${s.ctas} ${s.r4}`}>
              <Link href="/signup" className={`${s.btn} ${s.btnPri}`}>{c.ctaPrimary} <span aria-hidden="true">→</span></Link>
              <SecondaryCta {...second} />
            </div>
          </div>

          <div className={s.inboxWrap}>
          <figure className={s.inbox} aria-label={c.inbox.label}>
            <div className={s.ibTop}>
              <b>{c.inbox.title}</b>
              <div className={s.filters} aria-hidden="true">
                {c.inbox.filters.map((f, i) => <span key={f} className={i === 1 ? s.on : undefined}>{f}</span>)}
              </div>
            </div>
            <ul className={s.list} aria-hidden="true">
              {c.inbox.rows.map((r) => (
                <li key={r.name} className={`${s.row} ${r.selected ? s.rowSel : ""}`}>
                  <Ch id={r.ch} />
                  <div className="min-w-0">
                    <b>{r.name}<small className={s.mono}>{r.time}</small></b>
                    <p>{r.text}</p>
                    <span className={`${s.st} ${s.mono} ${STATE_CLS[r.state]}`}>{r.state === "bot" ? "✓ " : r.state === "team" ? "↪ " : ""}{r.label}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className={s.conv}>
              <div className={s.convHead}>
                <div><b>{c.inbox.conv.who}</b><small>{c.inbox.conv.since}</small></div>
                <span className={`${s.who} ${s.mono}`}>{c.inbox.conv.assigned}</span>
              </div>
              <div className={s.msgs}>
                {c.inbox.conv.messages.map((m, i) => (
                  <p key={i} className={`${s.m} ${m.from === "customer" ? s.mIn : s.mOut}`}>
                    {m.from === "assistant" && <span className={`${s.tag} ${s.mono}`}>{c.inbox.conv.assistant}</span>}
                    {m.text}<time className={s.mono}>{m.time}</time>
                  </p>
                ))}
                <p className={`${s.sys} ${s.mono}`}>{c.inbox.conv.handoff}</p>
                <p className={s.note}><b className={s.mono}>{c.inbox.conv.noteLabel}</b>{c.inbox.conv.note}</p>
              </div>
              <div className={s.composer} aria-hidden="true"><span>{c.inbox.conv.composer}</span><em>{c.inbox.conv.send}</em></div>
            </div>
          </figure>
          <p className={`${s.example} ${s.mono}`}>{c.inbox.example}</p>
          </div>
        </section>
      </div>

      <section className={s.chanbar} id="canales" aria-labelledby="channels-title">
        <div className={`${s.wrap} ${s.chanbarIn}`}>
          <h2 id="channels-title" className={`${s.chanLbl} ${s.mono}`}>{c.channelsTitle}</h2>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {c.channels.map((ch) => {
              const st = CHANNEL_AVAILABILITY[ch.id];
              return (
                <li key={ch.id} className={s.cc}>
                  <Ch id={ch.id} />{ch.name}
                  {st !== "available" && <small className={st === "soon" ? s.soon : s.beta}>{ch.state}</small>}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className={s.day} aria-labelledby="day-title">
        <div className={s.wrap}>
          <h2 id="day-title" className={`${s.h2} ${s.display} ${s.reveal}`}>{c.day.title}</h2>
          <p className={`${s.daySub} ${s.reveal}`}>{c.day.sub}</p>
          <div className={s.rail} aria-hidden="true">
            <div className={s.axis} />
            <div className={s.open}><span className={s.mono}>{c.day.open}</span></div>
            {c.day.pins.map((p) => (
              <div key={p.time} className={`${s.pin} ${p.high ? s.pinHigh : ""}`} style={{ left: `${(p.at / 24) * 100}%` }}>
                <div className={s.q}>
                  <time className={s.mono}><Ch id={p.ch} />{p.time}</time>
                  {p.text}
                  <i className={`${s.mono} ${p.state === "team" ? s.h : ""}`}>{p.label}</i>
                </div>
              </div>
            ))}
            <div className={`${s.hrs} ${s.mono}`}><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
          </div>
          <ul className={s.mlist}>
            {c.day.pins.map((p) => (
              <li key={p.time} className={s.ml}>
                <time className={s.mono}>{p.time}</time>{p.text}
                <i className={`${s.mono} ${p.state === "team" ? s.h : ""}`}>{p.label}</i>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="como" className={s.sec} aria-labelledby="flow-title">
        <div className={s.wrap}>
          <h2 id="flow-title" className={`${s.h2} ${s.display} ${s.reveal}`}>{c.flow.title}</h2>
          <ol className={s.flow}>
            {c.flow.steps.map((st, i) => (
              <li key={st.h} className={`${s.fs} ${s.reveal}`}>
                <span className={s.dot} aria-hidden="true">{i === c.flow.steps.length - 1 ? "✓" : i + 1}</span>
                <h3>{st.h}</h3>
                <p>{st.p}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="empresas" className={s.sec} aria-labelledby="sizes-title">
        <div className={s.wrap}>
          <h2 id="sizes-title" className={`${s.h2} ${s.display} ${s.reveal}`}>{c.sizes.title}</h2>
          <p className={`${s.sub2} ${s.reveal}`}>{c.sizes.sub}</p>
          <div className={s.sizes}>
            {c.sizes.items.map((z, i) => (
              <article key={z.h} className={`${s.sz} ${i === 1 ? s.szMid : ""} ${s.reveal}`}>
                <p className={s.szWho}>{z.who}</p>
                <h3>{z.h}</h3>
                <p>{z.p}</p>
                <ul>{z.items.map((it) => <li key={it}>{it}</li>)}</ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="equipos" className={`${s.sec} ${s.secLast}`} aria-labelledby="team-title">
        <div className={s.wrap}>
          <h2 id="team-title" className={`${s.h2} ${s.display} ${s.reveal}`}>{c.team.title}</h2>
          <div className={s.feat}>
            {c.team.items.map((f, i) => (
              <div key={f.h} className={`${s.fc} ${s.reveal}`}>
                <h3><span aria-hidden="true" className={s.g} style={{ background: GLYPH[i % GLYPH.length] }} />{f.h}</h3>
                <p>{f.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="seguridad" className={s.trust} aria-labelledby="trust-title">
        <div className={`${s.wrap} ${s.trustIn}`}>
          <div>
            <h2 id="trust-title" className={`${s.h2} ${s.display} ${s.reveal}`}>{c.trust.title}</h2>
            <p className={`${s.sub2} ${s.reveal}`}>{c.trust.sub}</p>
          </div>
          <ul>
            {c.trust.items.map((t) => <li key={t.h} className={s.reveal}><b>{t.h}</b><span>{t.p}</span></li>)}
          </ul>
        </div>
      </section>

      <section className={s.final} aria-labelledby="final-title">
        <div className={s.wrap}>
          <h2 id="final-title" className={`${s.h2} ${s.display} ${s.reveal}`}>{c.finalTitle}</h2>
          <div className={`${s.ctas} mt-9`}>
            <Link href="/signup" className={`${s.btn} ${s.btnMango}`}>{c.ctaPrimary} <span aria-hidden="true">→</span></Link>
            <SecondaryCta {...second} light />
          </div>
          <p className={s.honest}>{c.honest}</p>
          <div className={s.giant} aria-hidden="true">hola<span className={s.giantDot} /></div>
        </div>
      </section>
    </>
  );
}
