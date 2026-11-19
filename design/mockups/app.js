/* Conversa clickable prototype. Brand: ?brand=chefman|aurora. Screen: #dashboard etc. Add &capture=1 to hide the prototype helper. */
(function () {
  const Q = new URLSearchParams(location.search);
  const brandId = BRANDS[Q.get("brand")] ? Q.get("brand") : "chefman";
  let B = { ...BRANDS[brandId] };
  const D = DATA[brandId];
  if (Q.get("capture") === "1") document.documentElement.classList.add("capture");
  const app = document.getElementById("app");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const qs = (extra = "") => `?brand=${brandId}${Q.get("capture") === "1" ? "&capture=1" : ""}${extra}`;

  /* ---------- icons (stroke, 24px grid) ---------- */
  const P = {
    home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
    chat: "M4 5h16v11H9l-5 4z",
    flask: "M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 14h9",
    book: "M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20M8 7h8",
    sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
    folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z",
    plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
    puzzle: "M10 4a2 2 0 1 1 4 0v1h4v4h-1a2 2 0 1 0 0 4h1v5H5v-5h1a2 2 0 1 0 0-4H5V5h5z",
    palette: "M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.4-2l-.3-.8c-.4-1 .3-2.2 1.4-2.2H17a4 4 0 0 0 4-4c0-5-4-9-9-9zM7.5 11.5h0M10 7.5h0M14.5 7.5h0",
    users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5A3.25 3.25 0 1 0 10 4a3.25 3.25 0 0 0 0 6.5M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 4.2a3.25 3.25 0 0 1 0 6.1",
    card: "M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM3 10h18M7 15h3",
    chev: "M8 10l4 4 4-4",
    chevR: "M10 7l5 5-5 5",
    left: "M14 7l-5 5 5 5",
    check: "M5 12.5l4.5 4.5L19 7.5",
    upload: "M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    file: "M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5zM14 3v4.5h4.5",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
    alert: "M12 4 2.8 19.5h18.4zM12 10v4M12 17h0",
    bot: "M12 4v3M6 7h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9 12h0M15 12h0M9.5 15h5",
    person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0",
    send: "M4 12 20 4l-6 16-2.5-6.5z",
    reset: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4",
    shield: "M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
    sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
    mail: "M3 6h18v12H3zM3 7l9 6 9-6",
    menu: "M4 7h16M4 12h16M4 17h16",
    x: "M6 6l12 12M18 6 6 18",
    more: "M5 12h0M12 12h0M19 12h0",
    eye: "M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9c-2.5-2.7-3.5-5.7-3.5-9s1-6.3 3.5-9z",
    phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
    bag: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
  };
  const ic = (n, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;
  const tgSvg = (fill = "#fff") => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="${fill}" d="M21.5 4.3 2.9 11.5c-1.3.5-1.3 1.2-.2 1.6l4.8 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.4-1.6zM9.6 14.2l8.6-5.4c.4-.3.8-.1.5.2l-7.1 6.4-.3 3.2z"/></svg>`;
  const waSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5zm5.3 13.4c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 1.9 1.1 1 2 1.3 2.3 1.4.3.1.5.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.6-.1 1.2z"/></svg>`;
  const igSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="#fff"/></svg>`;
  const msSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M12 2.5C6.6 2.5 2.5 6.4 2.5 11.6c0 2.7 1.1 5.1 3 6.7v3.2l2.9-1.6c1.1.3 2.3.5 3.6.5 5.4 0 9.5-3.9 9.5-9.1S17.4 2.5 12 2.5zm1 12.2-2.4-2.6-4.7 2.6 5.2-5.5 2.5 2.6 4.6-2.6z"/></svg>`;
  const shopSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M15.8 4.6s-.3.1-.7.2c-.4-1.2-1.1-2.3-2.4-2.3h-.1c-.4-.5-.8-.7-1.2-.7-3 0-4.4 3.7-4.9 5.6l-2.1.7c-.6.2-.7.2-.7.8L2 20l12 2.2 6.5-1.4S16 4.7 15.8 4.6zm-3.3.9-2 .6c.4-1.5 1.1-2.2 1.7-2.5.2.5.3 1.1.3 1.9zm-1.3-2.6c.1 0 .2 0 .3.1-.8.4-1.7 1.3-2 3.3l-1.6.5c.4-1.5 1.5-3.9 3.3-3.9zm.5 8.7s-.6-.3-1.4-.3c-1.1 0-1.2.7-1.2.9 0 1 2.5 1.3 2.5 3.6 0 1.8-1.1 2.9-2.7 2.9-1.9 0-2.8-1.2-2.8-1.2l.5-1.7s1 .9 1.8.9c.5 0 .8-.4.8-.7 0-1.3-2.1-1.3-2.1-3.4 0-1.8 1.3-3.5 3.8-3.5 1 0 1.4.3 1.4.3z"/></svg>`;

  const vars = (b) => Color.derive(b);
  const applyVars = (el, v) => Object.entries(v).forEach(([k, val]) => k.startsWith("--") && el.style.setProperty(k, val));
  const logoTile = (b, v) => `<span class="logo-tile">${Color.logoSvg(b, v)}</span>`;
  const otherLogo = (m) => `<span class="logo-tile"><svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="${m.color}"/><text x="20" y="25.5" text-anchor="middle" font-family="Figtree, sans-serif" font-weight="800" font-size="14" fill="#fff">${m.initials}</text></svg></span>`;
  const brandLabel = (b) => `${esc(b.name)}${b.tag ? ` <span class="muted" style="font-weight:500;font-family:var(--font);font-size:.78em">(${esc(b.tag)})</span>` : ""}`;
  const statusLbl = { needs_human: "Necesita a una persona", bot: "Asistente", human: "Con una persona", resolved: "Resuelta" };
  const statusIc = { needs_human: "person", bot: "bot", human: "users", resolved: "check" };
  const reasonLbl = { safety: "reportó un problema de seguridad", legal: "mencionó un tema legal", human_request: "pidió hablar con una persona" };
  const stBadge = (s) => `<span class="badge s-${s}">${ic(statusIc[s], "sm")}${statusLbl[s]}</span>`;

  let V = vars(B);
  applyVars(document.documentElement, V);
  document.title = `${B.name} · Conversa (prototipo)`;

  /* ---------- tenant shell ---------- */
  const NAV = [
    ["Atención", [["dashboard", "Inicio", "home"], ["inbox", "Mensajes", "chat", 2], ["simulator", "Probar mi asistente", "flask"]]],
    ["Tu asistente", [["context", "Contexto", "book"], ["tone", "Tono", "sliders"], ["sources", "Fuentes de datos", "folder"]]],
    ["Conexiones", [["channels", "Canales", "plug"], ["addons", "Complementos", "puzzle"]]],
    ["Tu negocio", [["brand", "Marca", "palette"], ["team", "Equipo", "users"], ["billing", "Plan y uso", "card"]]],
  ];
  const CRUMB = Object.fromEntries(NAV.flatMap(([g, items]) => items.map(([id, l]) => [id, [g, l]])));

  function shell(active, body, opts = {}) {
    const groups = NAV.map(([g, items]) => `<div class="nav-group">${g}</div>` + items.map(([id, label, icon, count]) =>
      `<a href="${qs()}#${id}" ${id === active ? 'aria-current="page"' : ""}>${ic(icon)}<span>${label}</span>${count ? `<span class="count" aria-label="${count} esperan a una persona">${count}</span>` : ""}</a>`).join("")).join("");
    const pop = DATA.memberships.map((m) => {
      const b = BRANDS[m.brand];
      const logo = b ? logoTile(b, vars(b)) : otherLogo(m);
      const name = b ? b.name + (b.tag ? ` (${b.tag})` : "") : m.name;
      const href = b ? `?brand=${m.brand}${Q.get("capture") === "1" ? "&capture=1" : ""}${location.hash}` : "#";
      return `<a href="${href}" ${m.brand === brandId ? 'aria-current="true"' : ""}>${logo}<span class="grow"><span style="display:block;font-weight:600;font-size:14px">${esc(name)}</span><span class="xs muted">${m.role}</span></span>${m.brand === brandId ? ic("check", "sm") : ""}</a>`;
    }).join("");
    const [g, l] = CRUMB[active] || ["", ""];
    return `<div class="shell">
      <aside class="side" id="side" aria-label="Menú principal">
        <div style="position:relative">
          <button class="tenant-btn" id="tenantBtn" title="Cambiar de negocio" aria-label="${esc(B.name)}: cambiar de negocio" aria-haspopup="true" aria-expanded="false" aria-controls="tenantPop">
            ${logoTile(B, V)}
            <span class="grow"><span class="tenant-name ellipsis" style="display:block">${esc(B.name)}</span><span class="tenant-sub ellipsis" style="display:block">${B.tag ? esc(B.tag) : esc(B.industry)}</span></span>
            ${ic("chev", "sm")}
          </button>
          <div class="tenant-pop" id="tenantPop" hidden style="top:62px;left:0;right:0">
            <div class="xs muted" style="padding:6px 8px 4px">Tus negocios</div>${pop}
            <hr class="divider" style="margin:6px 0"><a href="#">${ic("sparkle", "sm")}<span class="small">Crear otro negocio</span></a>
          </div>
        </div>
        <nav class="nav">${groups}</nav>
        <div class="side-foot">${Color.logoSvg(PLATFORM, vars(PLATFORM))}<span>Funciona con Conversa</span></div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="btn btn-ghost menu-btn" id="menuBtn" aria-label="Abrir menú" aria-controls="side">${ic("menu")}</button>
          <span class="m-brand">${logoTile(B, V)}<b class="tenant-name">${esc(B.name)}</b></span>
          <span class="crumb">${g} / <b>${l}</b></span>
          <span class="grow"></span>
          <span class="user-chip"><span class="uname small"><b style="font-weight:600">${DATA.user.name}</b> <span class="muted">· Admin</span></span><span class="avatar" aria-hidden="true">${DATA.user.initials}</span></span>
        </header>
        ${opts.raw ? body : `<main class="content ${opts.wide ? "wide" : ""}">${body}</main>`}
      </div>
    </div>`;
  }
  const head = (title, sub, action = "") => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div>${action}</div>`;

  /* ---------- 1. sign-up (platform) ---------- */
  function signup() {
    const pv = PLATFORM, pvv = vars(pv);
    const mini = (b) => {
      const v = vars(b);
      const st = Object.entries(v).filter(([k]) => k.startsWith("--")).map(([k, x]) => `${k}:${x}`).join(";");
      return `<div class="mini-app" style="${st}">
        <div class="mh">${logoTile(b, v)}<b class="tenant-name" style="font-size:14px">${esc(b.name)}</b><span class="grow"></span><span class="badge s-needs_human" style="height:20px;font-size:11px">2 esperan</span></div>
        <div class="mb">
          ${[["Daniela R.", "needs_human", "Necesita a una persona"], ["Jorge M.", "bot", "Asistente"], ["Sofía G.", "resolved", "Resuelta"]].map(([n, s, l]) => `<div class="mini-row"><span class="avatar" style="width:26px;height:26px;font-size:10px">${n[0]}${n.split(" ")[1][0]}</span><b style="font-weight:600">${n}</b><span class="grow"></span><span class="badge s-${s}" style="height:20px;font-size:10.5px">${l}</span></div>`).join("")}
          <button class="btn btn-primary btn-sm" tabindex="-1" style="align-self:flex-start;margin-top:4px">Responder</button>
        </div></div>`;
    };
    return `<div class="auth platform">
      <section class="auth-form">
        <div class="p-logo">${logoTile(pv, pvv)}<b>Conversa</b><span class="prov">${pv.provisional}</span></div>
        <form onsubmit="return false" aria-labelledby="su-t">
          <h1 id="su-t">Crea tu cuenta</h1>
          <p class="muted" style="margin:10px 0 26px;font-size:16px">Un asistente que contesta a tus clientes en Telegram y te avisa cuando alguien necesita a una persona.</p>
          <button type="button" class="btn btn-google btn-lg btn-block"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.5z"/><path fill="#34A853" d="M12 23.5c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.4 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3a11.5 11.5 0 0 0 10.2 6.3z"/><path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4z"/><path fill="#EA4335" d="M12 5c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.5 11.5 0 0 0 1.8 6.8l3.8 3C6.5 7 9 5 12 5z"/></svg>Continuar con Google</button>
          <div class="or">o con tu correo</div>
          <div class="stack">
            <label class="field"><span class="label">Correo</span><input class="input" type="email" autocomplete="email" placeholder="tu@negocio.example.com" value="mariana@example.com"></label>
            <label class="field"><span class="label">Contraseña</span><input class="input" type="password" autocomplete="new-password" value="••••••••••••"><span class="hint">Mínimo 10 caracteres. Te mandaremos un correo para confirmar tu cuenta.</span></label>
          </div>
          <button class="btn btn-primary btn-lg btn-block" style="margin-top:20px">Crear cuenta</button>
          <p class="small muted" style="margin-top:16px;text-align:center">¿Ya tienes cuenta? <a href="#">Entrar</a></p>
          <p class="xs muted" style="margin-top:28px;text-align:center">Al crear tu cuenta aceptas los <a href="#">Términos</a> y el <a href="#">Aviso de privacidad</a>.</p>
        </form>
      </section>
      <section class="auth-art" aria-label="Así se ve con tu marca">
        <div class="eyebrow" style="color:#7FB3AB">Con tu logo y tus colores</div>
        <h2 style="margin-top:12px">Cada negocio ve su propia marca, no la nuestra.</h2>
        <p>Tu equipo atiende desde un panel con tu logo y tus colores. Tus clientes hablan con el bot de Telegram de tu negocio.</p>
        <div class="stack-cards">
          <div style="position:absolute;left:0;top:0;transform:rotate(-3deg)">${mini(BRANDS.aurora)}</div>
          <div style="position:absolute;left:150px;top:96px;transform:rotate(2deg)">${mini(BRANDS.chefman)}</div>
        </div>
      </section>
    </div>`;
  }

  /* ---------- shared live brand preview ---------- */
  function preview(b) {
    const v = vars(b);
    const st = Object.entries(v).filter(([k]) => k.startsWith("--")).map(([k, x]) => `${k}:${x}`).join(";");
    return `<div class="pv" id="pv" style="${st}" aria-label="Vista previa en vivo">
      <div class="pv-bar"><i></i><i></i><i></i><span class="xs muted" style="margin-left:8px">Tu panel</span></div>
      <div class="pv-app">
        <div class="pv-side">
          <div class="row" style="gap:8px;margin-bottom:6px">${logoTile(b, v).replace('class="logo-tile"', 'class="logo-tile" style="width:28px;height:28px"')}<b class="tenant-name ellipsis">${esc(b.name || "Tu negocio")}</b></div>
          <div class="pv-nav">${ic("home", "sm")}Inicio</div><div class="pv-nav on">${ic("chat", "sm")}Mensajes</div><div class="pv-nav">${ic("book", "sm")}Contexto</div><div class="pv-nav">${ic("sliders", "sm")}Tono</div>
        </div>
        <div class="pv-main">
          <h4>Mensajes</h4>
          <div class="card" style="padding:10px 12px;display:flex;gap:10px;align-items:center;border-color:var(--b-soft);background:var(--b-softer)"><span class="avatar" style="width:28px;height:28px;font-size:11px">${D.convs[0].initials}</span><span class="grow small"><b>${esc(D.convs[0].name)}</b><br><span class="muted xs">Necesita a una persona</span></span></div>
          <div class="row" style="gap:8px"><button class="btn btn-primary btn-sm" tabindex="-1">Responder</button><button class="btn btn-secondary btn-sm" tabindex="-1">Devolver al asistente</button></div>
          <a href="#" tabindex="-1" class="small" style="font-weight:600">Ver todas las conversaciones</a>
        </div>
      </div>
      <div class="pv-widget">
        <span class="xs muted" style="position:absolute;left:16px;bottom:16px;max-width:150px;line-height:1.35;background:var(--surface);padding:6px 10px;border-radius:12px;border:1px solid var(--line)">Chat en tu sitio web · próximamente</span>
        <div class="wid">
          <div class="wid-head">${logoTile(b, v)}<span class="grow"><b style="display:block;font-size:13.5px;font-family:var(--b-font),var(--display)">${esc(b.name || "Tu negocio")}</b><span class="xs" style="opacity:.85">Responde ${esc(b.agent || "tu asistente")} · al momento</span></span></div>
          <div class="wid-body"><div class="bubble bot">¡Hola! Soy ${esc(b.agent || "tu asistente")}. ¿En qué te ayudo?</div><div class="bubble me">¿Dónde está mi pedido?</div><div class="bubble bot">Con gusto. ¿Me das tu número de pedido?</div></div>
          <div class="wid-foot"><span>Escribe un mensaje…</span><b>Enviar</b></div>
        </div>
        <div class="launcher" aria-hidden="true">${ic("chat")}</div>
      </div>
    </div>`;
  }
  function contrastReport(b) {
    const r = vars(b)._report;
    const ok = (x) => x >= 4.5 ? `<span class="badge good">${ic("check", "sm")}AA ${x.toFixed(1)}:1</span>` : `<span class="badge bad">${x.toFixed(1)}:1</span>`;
    return `<div class="contrast-line"><span class="chip-sample" style="background:${b.primary};color:${r.onPrimary}">Botón</span><span class="grow">Texto en botones: <b>${r.onPrimary === "#FFFFFF" ? "blanco" : "oscuro"}</b> (automático)</span>${ok(r.buttonRatio)}</div>
      <div class="contrast-line"><span class="chip-sample" style="background:#fff;color:${r.ink};border:1px solid var(--line)">Enlace</span><span class="grow">Enlaces y textos de marca${r.inkAdjusted ? `: oscurecido a <span class="mono">${r.ink}</span> para leerse bien` : ""}</span>${ok(r.inkRatio)}</div>
      <div class="contrast-line"><span class="chip-sample" style="background:${b.accent};color:${Color.onColor(b.accent)}">Equipo</span><span class="grow">Burbujas de tu equipo (color de acento)</span>${ok(r.accentRatio)}</div>`;
  }
  function brandForm(b, idp) {
    const color = (key, label, hint) => `<div class="field"><span class="label" id="${idp}${key}-l">${label}</span><div class="color-row"><input type="color" class="swatch" data-k="${key}" value="${b[key]}" aria-labelledby="${idp}${key}-l"><input class="input mono" data-k="${key}" value="${b[key]}" aria-labelledby="${idp}${key}-l" maxlength="7"></div>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
    return `<div class="stack" style="--gap:16px">
      <div class="field"><span class="label">Logo</span>
        <div class="logo-drop" role="button" tabindex="0" aria-label="Subir logo">${logoTile(b, vars(b))}<div class="grow"><b>Arrastra tu logo aquí</b> o <a href="#">elige un archivo</a><div class="xs muted" style="margin-top:2px">PNG o SVG cuadrado, mínimo 256 px. Se usa en tu panel y como foto de tu bot.</div></div></div>
      </div>
      <label class="field"><span class="label">Nombre que ven tus clientes</span><input class="input" data-k="name" value="${esc(b.name)}"></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">${color("primary", "Color principal", "Botones y acciones")}${color("accent", "Color de acento", "Burbujas de tu equipo")}</div>
      ${color("background", "Fondo del menú", "Un tono suave de tu marca")}
      <label class="field"><span class="label">Tipografía de títulos</span><select class="input" data-k="font">${["Bricolage Grotesque", "Fraunces", "Figtree"].map((f) => `<option ${b.font === f ? "selected" : ""}>${f}</option>`).join("")}</select></label>
      <div class="card" style="padding:6px 14px" id="${idp}contrast" aria-live="polite">${contrastReport(b)}</div>
    </div>`;
  }
  function wireBrandForm(root, state, onChange) {
    root.querySelectorAll("[data-k]").forEach((el) => {
      el.addEventListener("input", () => {
        const k = el.dataset.k;
        let val = el.value;
        if (["primary", "accent", "background"].includes(k)) {
          if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
          root.querySelectorAll(`[data-k="${k}"]`).forEach((o) => o !== el && (o.value = val));
        }
        state[k] = val;
        onChange();
      });
    });
  }

  /* ---------- 2. onboarding: Tu marca ---------- */
  function onboarding() {
    const pvv = vars(PLATFORM);
    const steps = [["Negocio", "done"], ["Marca", "cur"], ["Canal", ""], ["Prueba", ""]];
    return `<div class="onb">
      <header class="onb-top platform">
        <div class="p-logo">${logoTile(PLATFORM, pvv)}<b>Conversa</b></div>
        <ol class="stepper" aria-label="Pasos para empezar">${steps.map(([s, c], i) => `${i ? '<li class="sep" aria-hidden="true"></li>' : ""}<li class="${c}" ${c === "cur" ? 'aria-current="step"' : ""}><i>${c === "done" ? "✓" : i + 1}</i><span>${s}</span></li>`).join("")}</ol>
        <a href="#" class="small muted">Terminar después</a>
      </header>
      <div class="onb-body">
        <section>
          <div class="eyebrow">Paso 2 de 4</div>
          <h1 style="margin:6px 0 8px">Tu marca</h1>
          <p class="muted" style="margin-bottom:22px">Sube tu logo y elige tus colores. Tu equipo verá tu marca en el panel; nosotros cuidamos que todo se lea bien.</p>
          <div id="obForm">${brandForm(B, "ob-")}</div>
          <div class="onb-foot"><button class="btn btn-ghost">${ic("left", "sm")}Atrás</button><span class="grow"></span><button class="btn btn-primary btn-lg">Continuar</button></div>
        </section>
        <section aria-label="Vista previa">
          <div class="row between" style="margin-bottom:10px"><b>Vista previa en vivo</b><span class="xs muted">Cambia un color y mira</span></div>
          <div id="obPv">${preview(B)}</div>
          <p class="xs muted" style="margin-top:12px">En Telegram tus clientes ven el nombre y la foto de tu bot. Los colores se usan en tu panel y en el chat para tu sitio web (próximamente).</p>
        </section>
      </div>
    </div>`;
  }

  /* ---------- 3. dashboard ---------- */
  function dashboard() {
    const steps = [
      ["Cuéntale a tu asistente sobre tu negocio", "context", true],
      ["Elige cómo habla tu asistente", "tone", true],
      ["Agrega tus documentos y enlaces", "sources", true],
      ["Prueba cómo responde tu asistente (sin conectar nada)", "simulator", true],
      ["Conecta tu bot de Telegram", "channels", true],
      ["Invita a tu equipo", "team", false],
      ["Conecta tu tienda Shopify", "addons", false, true],
    ];
    const nextIdx = steps.findIndex((s) => !s[2] && !s[3]);
    const waiting = D.convs.filter((c) => c.status === "needs_human");
    return shell("dashboard", `
      ${head(`Hola, Mariana`, `Esto pasa hoy en ${esc(B.name)}. Tu asistente atiende; tú entras cuando alguien necesita a una persona.`)}
      <div class="kpis">
        <a href="${qs()}#inbox" class="card kpi alert" style="text-decoration:none;color:inherit"><div class="row between"><span class="eyebrow" style="color:var(--s-need)">Ahora</span>${ic("person", "sm")}</div><div class="num">${waiting.length}</div><div class="lbl">Esperan a una persona</div></a>
        <div class="card kpi"><div class="row between"><span class="eyebrow">Este mes</span>${ic("bot", "sm")}</div><div class="num">${brandId === "aurora" ? 64 : 318}</div><div class="lbl">Atendidos por el asistente</div></div>
        <div class="card kpi"><div class="row between"><span class="eyebrow">Este mes</span>${ic("check", "sm")}</div><div class="num">${brandId === "aurora" ? 58 : 296}</div><div class="lbl">Resueltos</div></div>
        <div class="card kpi"><div class="row between"><span class="eyebrow">Uso de IA del mes</span>${ic("sparkle", "sm")}</div><div class="num">${brandId === "aurora" ? 61 : 42}<span style="font-size:20px">%</span></div><div class="meter" style="margin:4px 0 8px"><i style="width:${brandId === "aurora" ? 61 : 42}%"></i></div><div class="lbl">del tope mensual · se renueva el 1 dic</div></div>
      </div>
      <div class="dash-grid">
        <section class="card card-pad" aria-labelledby="ck">
          <div class="row between" style="margin-bottom:6px"><h2 id="ck" class="card-title">Deja listo tu asistente</h2><span class="small muted">5 de 6 pasos listos</span></div>
          <div class="meter" style="margin:8px 0 14px"><i style="width:83%"></i></div>
          <ol class="steps">${steps.map(([t, href, done, opt], i) => `<li class="step ${done ? "done" : ""} ${i === nextIdx ? "next" : ""}">
            <span class="step-mark" aria-label="Paso ${i + 1}">${done ? ic("check", "sm") : i + 1}</span>
            <span class="grow"><span class="t">${t}</span>${i === nextIdx ? `<span class="small muted" style="display:block">Ana y Luis podrán contestar desde su propia cuenta.</span>` : ""}</span>
            ${done ? '<span class="badge good">Listo</span>' : opt ? '<span class="badge">Opcional · en modo demostración</span>' : i === nextIdx ? '<span class="badge info">Siguiente paso</span>' : ""}
            <a class="btn ${i === nextIdx ? "btn-primary" : "btn-secondary btn-sm"}" href="${qs()}#${href}">${done ? "Revisar" : "Empezar"}</a>
          </li>`).join("")}</ol>
        </section>
        <section class="card card-pad" aria-labelledby="wt">
          <div class="row between"><h2 id="wt" class="card-title">Quién espera</h2><a class="small" href="${qs()}#inbox" style="font-weight:600">Ver mensajes</a></div>
          <div style="margin-top:10px">${waiting.map((c) => `<a class="wait-item" href="${qs()}#inbox"><span class="av-wrap"><span class="avatar">${c.initials}</span><span class="ch-dot">${tgSvg()}</span></span><span class="grow"><b style="display:block">${c.name}</b><span class="small muted ellipsis" style="display:block">${esc(c.prev)}</span></span><span class="xs muted">${c.time}</span>${c.urgent ? '<span class="badge urgent">Urgente</span>' : ""}</a>`).join("")}</div>
          <hr class="divider">
          <div class="row small"><span class="ch-logo" style="width:34px;height:34px;border-radius:10px;background:var(--tg)">${tgSvg()}</span><span class="grow"><b>Telegram conectado</b><br><span class="muted mono">${B.bot}</span></span><span class="badge good"><span class="dot"></span>Funciona</span></div>
        </section>
      </div>`);
  }

  /* ---------- 4. inbox ---------- */
  let openId = "c1";
  let filter = "all";
  function convItem(c) {
    return `<li class="conv ${c.urgent ? "urgent" : ""} ${c.unread ? "unread" : ""}" role="option" tabindex="0" data-id="${c.id}" aria-selected="${c.id === openId}">
      <span class="av-wrap"><span class="avatar">${c.initials}</span>${c.sim ? "" : `<span class="ch-dot" title="Telegram">${tgSvg()}</span>`}</span>
      <span class="grow"><span class="row between" style="gap:8px"><span class="who ellipsis">${esc(c.name)}</span><span class="time">${c.time}</span></span>
      <span class="prev ellipsis" style="display:block">${esc(c.prev)}</span>
      <span class="tags">${c.urgent ? '<span class="badge urgent">' + ic("alert", "sm") + "Urgente</span>" : ""}${stBadge(c.status)}${c.sim ? '<span class="badge sim">SIM · prueba</span>' : '<span class="badge tg">Telegram</span>'}${c.agent ? `<span class="badge">Atiende ${c.agent}</span>` : ""}</span></span>
    </li>`;
  }
  function inbox() {
    const counts = { all: D.convs.length };
    D.convs.forEach((c) => (counts[c.status] = (counts[c.status] || 0) + 1));
    const list = D.convs.filter((c) => filter === "all" || c.status === filter);
    const c = D.convs.find((x) => x.id === openId) || D.convs[0];
    const isUrgent = c.id === "c1";
    const thread = isUrgent ? D.thread : [{ day: "Hoy" }, { from: "customer", t: c.prev.replace(/^(Asistente|Tú): /, ""), at: "10:20" }, ...(c.status !== "needs_human" ? [{ from: c.status === "human" ? "agent" : "bot", who: "Ana Torres", t: c.prev.replace(/^(Asistente|Tú): /, ""), at: "10:21" }] : [])];
    const msgs = thread.map((m) => m.day ? `<div class="day">${m.day}</div>` : m.event ? `<div class="event" role="note">${ic("person", "sm")}${m.event}</div>` :
      `<div class="bubble-row ${m.from !== "customer" ? "out" : ""}"><div class="meta">${m.from === "customer" ? esc(c.name.split(" ")[0]) : m.from === "bot" ? `${ic("bot", "sm")}${esc(B.agent)} · asistente` : `${ic("person", "sm")}${esc(m.who)} · equipo`}<span>·</span><span>${m.at}</span></div><div class="bubble ${m.from}">${esc(m.t)}</div></div>`).join("");
    const filters = [["all", "Todas"], ["needs_human", "Necesitan a una persona"], ["bot", "Asistente"], ["human", "Con una persona"], ["resolved", "Resueltas"]];
    return shell("inbox", `<div class="inbox ${Q.get("open") === "1" ? "has-open" : ""}" id="inboxView">
      <section class="inbox-list" aria-label="Conversaciones">
        <div class="inbox-tools">
          <div class="row between"><h1>Mensajes</h1><a class="btn btn-secondary btn-sm" href="${qs()}#simulator">${ic("flask", "sm")}Probar mi asistente</a></div>
          <label class="sr" for="q">Buscar cliente</label>
          <div style="position:relative;margin-top:12px"><span style="position:absolute;left:12px;top:13px;color:var(--muted)">${ic("search", "sm")}</span><input id="q" class="input" placeholder="Buscar cliente..." style="padding-left:36px;min-height:42px"></div>
          <div class="filters" role="group" aria-label="Filtrar por estado">${filters.map(([k, l]) => `<button data-f="${k}" aria-pressed="${filter === k}">${l}<span class="n">${counts[k] || 0}</span></button>`).join("")}</div>
        </div>
        <div class="waiting-banner" role="status">${ic("person", "sm")}2 esperan a una persona<a href="#" data-f="needs_human">Ver quién espera</a></div>
        <ul class="conv-list" role="listbox" aria-label="Lista de conversaciones">${list.map(convItem).join("")}</ul>
      </section>
      <section class="thread" aria-label="Conversación con ${esc(c.name)}">
        <div class="thread-head">
          <a class="btn btn-ghost btn-sm back-link" href="${qs()}#inbox">${ic("left", "sm")}Volver a la lista</a>
          <span class="av-wrap"><span class="avatar lg">${c.initials}</span>${c.sim ? "" : `<span class="ch-dot">${tgSvg()}</span>`}</span>
          <div><b style="font-size:16px">${esc(c.name)}</b><div class="row" style="gap:6px;margin-top:3px">${c.urgent ? '<span class="badge urgent">Urgente</span>' : ""}${stBadge(c.status)}<span class="xs muted">${c.sim ? "Simulador" : "Telegram"}${c.status === "needs_human" ? ` · Esperando: ${c.time}` : ""}</span></div></div>
          <div class="actions"><button class="btn btn-secondary btn-sm" id="returnBtn">${ic("bot", "sm")}Devolver al asistente</button><button class="btn btn-secondary btn-sm" id="resolveBtn">${ic("check", "sm")}Marcar como resuelta</button></div>
        </div>
        ${c.reason ? `<div class="notice ${c.urgent ? "urgent" : "warn"}" style="margin:12px 22px 0;border-radius:12px;padding:10px 14px">${ic(c.urgent ? "alert" : "person")}<span><b>Motivo: ${reasonLbl[c.reason]}.</b> Responde tú; el asistente ya no contesta aquí.</span></div>` : ""}
        <div class="msgs" id="msgs" role="log" aria-label="Mensajes de la conversación">${msgs}</div>
        <form class="composer" id="composer" onsubmit="return false">
          <label class="sr" for="reply">Tu respuesta</label>
          <textarea class="input" id="reply" placeholder="Escribe tu respuesta...">${isUrgent ? esc(D.draft) : ""}</textarea>
          <div class="row" style="margin-top:10px"><span class="xs muted grow">Al responder, el asistente deja de contestar esta conversación. Enter envía; Shift+Enter hace un salto de línea.</span><button class="btn btn-primary" id="replyBtn">${ic("send", "sm")}Responder</button></div>
        </form>
      </section>
      <aside class="thread-side" aria-label="Detalles del cliente">
        <div class="eyebrow">Cliente</div>
        <div class="row" style="margin:10px 0 16px"><span class="avatar lg">${c.initials}</span><div><b>${esc(c.name)}</b><div class="xs muted">Escribe por Telegram</div></div></div>
        <dl class="kv"><dt>Canal</dt><dd><span class="badge tg">Telegram</span></dd><dt>Estado</dt><dd>${statusLbl[c.status]}</dd><dt>Primer mensaje</dt><dd>${isUrgent ? (brandId === "aurora" ? "10 nov" : "8 nov") : "hoy"}</dd><dt>Conversaciones</dt><dd>${isUrgent ? 2 : 1}</dd></dl>
        <hr class="divider">
        <div class="eyebrow">Pedido</div>
        <p class="small muted" style="margin-top:8px">El asistente solo consulta el estado del pedido cuando el cliente da número y correo, y coinciden.</p>
        <div class="card" style="padding:12px;margin-top:10px;box-shadow:none;background:var(--canvas)"><div class="row between small"><b>Sin pedido vinculado</b>${ic("bag", "sm")}</div><div class="xs muted" style="margin-top:4px">Pídeselo si lo necesitas para la garantía.</div></div>
        <hr class="divider">
        <div class="eyebrow">Privacidad</div>
        <p class="xs muted" style="margin-top:8px">Los mensajes se guardan según tu política de retención. Los correos se muestran ocultos.</p>
      </aside>
    </div>`, { raw: true });
  }

  /* ---------- 5. simulator ---------- */
  const SIM = {
    "Mi pedido #1001": ["Con gusto te ayudo con tu pedido #1001. Para protegerte, ¿me confirmas el correo con el que compraste?", "ask"],
    "Garantía": [brandId === "aurora" ? "Si tu café llegó dañado o no es lo que pediste, te lo cambiamos dentro de 7 días. Escríbenos con tu número de pedido y una foto." : "La garantía cubre 1 año contra defectos de fabricación. Para hacerla válida, compártenos tu número de pedido y una foto del producto.", ""],
    "Hablar con una persona": ["Claro. Ya le pasé tu conversación a una persona del equipo; te escribirá en cuanto pueda.", "handoff"],
    [brandId === "aurora" ? "Me quemé con el café" : "Mi licuadora echó humo"]: ["Lamento mucho lo que pasó. Por tu seguridad, deja de usarlo. Ya le pasé tu caso a una persona del equipo.", "handoff"],
  };
  let simLog = [
    { me: true, t: "Mi pedido #1001" },
    { t: "Con gusto te ayudo con tu pedido #1001. Para protegerte, ¿me confirmas el correo con el que compraste?" },
    { me: true, t: "test@example.com" },
    { t: "¡Gracias! Tu pedido #1001 ya fue enviado.", order: true },
  ];
  function simMsgs() {
    return simLog.map((m) => `<div class="bubble-row ${m.me ? "out" : ""}"><div class="bubble ${m.me ? "me" : "bot"}">${esc(m.t)}${m.order ? `<div class="order-card"><div class="row between"><b class="mono">#1001</b><span class="badge good">Enviado</span></div><div class="xs muted" style="margin-top:6px">Paquetería: Envíos Demo · Guía <span class="mono">EJ123456789MX</span><br>Llega en 2 a 4 días hábiles.</div></div><div style="margin-top:8px">Solo puedo darte el estado del pedido. Si necesitas cambiar algo, te paso con una persona.</div>` : ""}</div></div>`).join("") +
      (simLog.some((m) => m.handoff) ? `<div class="event">${ic("person", "sm")}En esta prueba el asistente pasó la conversación a una persona, así que ya no responde.</div>` : "");
  }
  function simulator() {
    return shell("simulator", `
      ${head("Probar mi asistente", "Escribe como si fueras un cliente. Nada se envía a nadie y no cuenta como cliente real.", `<button class="btn btn-ghost" id="simReset">${ic("reset", "sm")}Empezar de nuevo</button>`)}
      <div class="sim-wrap">
        <div class="phone"><div class="phone-in">
          <div class="phone-top">${logoTile(B, V)}<div class="grow"><b style="font-size:14.5px">${esc(B.agent)} · ${esc(B.name)}</b><div class="xs muted">bot · <span class="mono">${B.bot}</span></div></div><span class="badge warn">Esto es una prueba</span></div>
          <div class="phone-msgs" id="simMsgs" role="log" aria-label="Conversación de prueba">${simMsgs()}</div>
          <div class="chips" role="group" aria-label="Ejemplos para probar">${Object.keys(SIM).map((k) => `<button class="chip" data-s="${esc(k)}">${esc(k)}</button>`).join("")}</div>
          <form class="phone-input" id="simForm" onsubmit="return false"><label class="sr" for="simIn">Mensaje de prueba</label><input class="input" id="simIn" placeholder="Escribe como cliente..."><button class="btn btn-primary">Enviar</button></form>
        </div></div>
        <div class="stack" style="--g:16px">
          <section class="card card-pad">
            <h2 class="card-title">Qué hizo tu asistente</h2>
            <p class="small muted" style="margin:4px 0 18px">Así respondió a «Mi pedido #1001». Te lo mostramos para que confíes en lo que dice.</p>
            <ol class="trace">
              <li><span class="tdot">${ic("search")}</span><b>Entendió que preguntan por un pedido</b><div class="small muted">Número detectado: <span class="mono">#1001</span></div></li>
              <li><span class="tdot">${ic("shield")}</span><b>Pidió el correo antes de dar datos</b><div class="small muted">Número y correo deben coincidir. Así nadie ve pedidos ajenos.</div></li>
              <li><span class="tdot">${ic("bag")}</span><b>Consultó tu tienda de demostración</b><div class="small muted">Solo el estado y la guía. No ve dirección, productos, teléfono ni pagos.</div></li>
              <li><span class="tdot">${ic("check")}</span><b>Respondió con el estado</b><div class="small muted">Sin prometer fechas exactas ni ofrecer cambios.</div></li>
            </ol>
          </section>
          <section class="card card-pad">
            <h2 class="card-title">Pasa con una persona cuando…</h2>
            <div class="row wrap" style="margin-top:12px;gap:8px">${["Seguridad: humo, fuego, quemadura, descarga", "Temas legales: PROFECO, abogado, demanda", "El cliente pide una persona", "Reembolsos y cancelaciones", "Fotos o notas de voz", "No sabe la respuesta"].map((x) => `<span class="badge" style="height:28px;font-size:12.5px">${x}</span>`).join("")}</div>
            <p class="small muted" style="margin-top:14px">Prueba «Hablar con una persona»: la conversación aparece en Mensajes con la etiqueta SIM.</p>
          </section>
          <section class="card card-pad row" style="gap:14px"><span class="ch-logo" style="background:var(--tg);width:40px;height:40px;border-radius:12px">${tgSvg()}</span><div class="grow"><b>¿Todo bien? Pruébalo en Telegram</b><div class="small muted">Escríbele a <span class="mono">${B.bot}</span> desde tu celular. Esa conversación sí es real.</div></div><a class="btn btn-secondary btn-sm" href="${qs()}#channels">Ver canal</a></section>
        </div>
      </div>`);
  }

  /* ---------- 6. context ---------- */
  function context() {
    const cards = DATA.sections.map(([k, title, hint], i) => {
      if (k === "warranty") return `<article class="card sec" style="grid-row:span 2" aria-labelledby="s-${k}">
        <div class="row between"><h3 id="s-${k}">${title}</h3><span class="badge good">Lista</span></div><p class="hint">${hint}</p>
        <div class="row between" style="margin:16px 0 12px"><span class="small" style="font-weight:600" id="m-${k}">Cómo dar esta información</span><div class="seg" role="group" aria-labelledby="m-${k}"><button aria-pressed="false">${ic("book", "sm")}Escribir</button><button aria-pressed="true">${ic("file", "sm")}Usar un archivo</button></div></div>
        <div class="filebox">
          <div class="row"><span class="file-ico">PDF</span><div class="grow"><b>${D.sections.file}</b><div class="xs muted">248 KB · subido el 14 nov</div></div><button class="btn btn-secondary btn-sm">Reemplazar</button><button class="btn btn-ghost btn-sm">Quitar</button></div>
          <div class="xs muted" style="margin-top:12px">Así se leyó el inicio del archivo:</div>
          <div class="preview-text">${esc(D.sections.filePreview)}</div>
        </div>
        <p class="xs muted" style="margin-top:10px">El asistente leerá este archivo en lugar del texto escrito. Tu texto escrito no se borra: queda guardado como borrador.</p>
        <details class="linked" open><summary>${ic("link", "sm")}Complementar con fuentes de datos <span class="badge brand" style="margin-left:auto">1 vinculada</span></summary>
          <p class="xs muted" style="margin-top:6px">Marca las fuentes que también hablan de este tema.</p>
          <label class="check"><input type="checkbox" checked>${ic("file", "sm")}<span class="grow">${esc(D.sources[4].title)}</span><span class="badge good">Lista</span></label>
          <label class="check"><input type="checkbox">${ic("globe", "sm")}<span class="grow">${esc(D.sources[1].title)}</span><span class="badge">En Contexto: Envíos</span></label>
          <div class="row" style="margin-top:10px"><label class="sr" for="addl">Dirección web para esta sección</label><input id="addl" class="input" placeholder="https://" style="min-height:40px"><button class="btn btn-secondary btn-sm">Agregar enlace</button></div>
        </details>
        <div class="using" style="margin-top:14px">${ic("eye", "sm")}Usando: archivo ${D.sections.file} · +1 fuente</div>
      </article>`;
      if (k === "business") return `<article class="card sec" aria-labelledby="s-${k}">
        <div class="row between"><h3 id="s-${k}">${title}</h3><span class="badge good">Lista</span></div><p class="hint">${hint}</p>
        <div class="row between" style="margin:16px 0 10px"><span class="small" style="font-weight:600" id="m-${k}">Cómo dar esta información</span><div class="seg" role="group" aria-labelledby="m-${k}"><button aria-pressed="true">${ic("book", "sm")}Escribir</button><button aria-pressed="false">${ic("file", "sm")}Usar un archivo</button></div></div>
        <label class="sr" for="t-${k}">${title}</label><textarea id="t-${k}" class="input" rows="4">${esc(D.sections.business)}</textarea>
        <div class="row between" style="margin-top:8px"><span class="using">${ic("eye", "sm")}Usando: texto</span><span class="xs muted">${D.sections.business.length} caracteres</span></div>
      </article>`;
      const empty = k === "extra" || k === "faq";
      const extra = k === "products" ? " · +1 fuente" : k === "shipping_returns" ? " · +1 fuente" : "";
      return `<article class="card sec compact" aria-labelledby="s-${k}"><div class="row between"><h3 id="s-${k}" style="font-size:15px">${title}</h3><span class="badge ${empty ? "" : "good"}">${empty ? "Vacía" : "Lista"}</span></div><p class="hint">${hint}</p>
        <div class="row between" style="margin-top:12px"><span class="using">${empty ? "Aún sin información" : `${ic("eye", "sm")}Usando: texto${extra}`}</span><button class="btn btn-secondary btn-sm">${empty ? "Llenar" : "Editar"}</button></div></article>`;
    });
    return shell("context", `
      ${head("Contexto del negocio", "Escribe o sube lo que el asistente debe saber. Solo responderá con esta información, así que sé claro y específico.")}
      <div class="card ctx-top"><div class="grow"><b>6 de 8 secciones listas</b><div class="small muted">Mientras más secciones llenes, mejores respuestas dará el asistente.</div></div><div style="width:280px" class="meter"><i style="width:75%"></i></div></div>
      <div class="ctx-grid">
        <div class="stack">${cards[0]}${cards[1]}${cards[2]}${cards[4]}${cards[5]}</div>
        <div class="stack">${cards[3]}${cards[6]}${cards[7]}</div>
      </div>
      <div class="savebar"><span class="badge warn"><span class="dot"></span>Tienes cambios sin guardar</span><span class="grow small muted">Al guardar, el asistente usa la nueva información de inmediato.</span><button class="btn btn-primary">Guardar cambios</button></div>`);
  }

  /* ---------- 7. tone ---------- */
  let tone = 3;
  function toneSamples() {
    const ord = ["Con gusto le ayudo. ¿Me proporciona su número de pedido?", "Claro, te ayudo. ¿Me compartes tu número de pedido?", "¡Claro! Pásame tu número de pedido y lo reviso.", "¡Va! Pásame tu número de pedido y lo checo al momento.", "¡Va, va! Pásame tu número de pedido y te digo cómo va 🚚"];
    const q = [["Hola", D.tone[tone - 1]], ["¿Dónde está mi pedido?", ord[tone - 1]], [D.q3, D.a3[tone - 1]]];
    return q.map(([a, b]) => `<div class="bubble q">${esc(a)}</div><div class="bubble a"><div class="xs muted" style="margin-bottom:2px">${esc(B.agent)}</div>${esc(b)}</div>`).join("");
  }
  function toneScreen() {
    const names = ["Formal", "Cortés", "Cercano", "Amigable", "Muy amigable"];
    return shell("tone", `
      ${head("Personalidad del asistente", "Define cómo habla y cuándo pasa con una persona.")}
      <div class="tone-grid">
        <section class="card card-pad stack">
          <label class="field"><span class="label">Nombre del asistente</span><input class="input" value="${esc(B.agent)}"><span class="hint">Así se presentará con tus clientes.</span></label>
          <hr class="divider" style="margin:6px 0">
          <div>
            <div class="row between"><span class="label" style="font-weight:600;font-size:13.5px" id="tl">Nivel de tono</span><span class="small muted" id="tnLbl">Nivel ${tone} de 5 · ${names[tone - 1]}</span></div>
            <div class="row" style="gap:16px;margin-top:6px"><span class="level-pill" id="tnNum" aria-hidden="true">${tone}</span><div class="grow"><input type="range" class="slider" id="toneR" min="1" max="5" step="1" value="${tone}" aria-labelledby="tl" aria-valuetext="${names[tone - 1]}">
              <div class="ticks" id="ticks">${names.map((n, i) => `<span ${i + 1 === tone ? 'aria-current="true"' : ""}>${n}</span>`).join("")}</div></div></div>
          </div>
          <hr class="divider" style="margin:6px 0">
          <div><span class="label" style="display:block;font-weight:600;font-size:13.5px;margin-bottom:8px">Recomendaciones de otros productos</span>
            <div class="opt-grid" role="group" aria-label="Recomendaciones de otros productos">${[["Apagado", "Nunca sugiere otros productos."], ["Suave", "Solo si el cliente lo pide."], ["Normal", "Cuando la conversación va bien."], ["Activo", "Máximo una vez, nunca en quejas."]].map(([a, b], i) => `<button class="opt" aria-pressed="${i === 1}"><b>${a}</b><span>${b}</span></button>`).join("")}</div></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <label class="field"><span class="label">Idioma principal</span><select class="input"><option>Español</option><option>English</option></select><span class="hint">Si el cliente escribe en otro idioma, se adapta.</span></label>
            <label class="field"><span class="label">Horario de atención</span><input class="input" value="${brandId === "aurora" ? "Todos los días · 7:00 a 21:00" : "Lun a vie · 9:00 a 18:00"}"><span class="hint">Hora del centro (Ciudad de México).</span></label>
          </div>
          <label class="field"><span class="label">Correo para avisos de atención humana</span><input class="input" value="atencion@${D.domain}"><span class="hint">Aquí te avisamos cuando un cliente necesita a una persona.</span></label>
          <div class="row" style="justify-content:flex-end"><button class="btn btn-primary">Guardar</button></div>
        </section>
        <section class="card card-pad" aria-labelledby="pvT" style="position:sticky;top:80px">
          <div class="row between"><h2 id="pvT" class="card-title">Así respondería</h2><div class="seg" role="group" aria-label="Idioma de la vista previa"><button aria-pressed="true">ES</button><button aria-pressed="false">EN</button></div></div>
          <p class="small muted" style="margin:4px 0 14px">Es el texto real que enviará en saludos, pedidos y cuando no sepa algo.</p>
          <div class="preview-chat" id="toneP" aria-live="polite">${toneSamples()}</div>
        </section>
      </div>`);
  }

  /* ---------- 8. sources ---------- */
  function sources() {
    const st = { indexed: '<span class="badge good"><span class="dot"></span>Lista</span>', reading: '<span class="badge info"><span class="dot"></span>Leyendo…</span>', error: '<span class="badge bad"><span class="dot"></span>Con error</span>' };
    const icon = { pdf: '<span class="file-ico" style="width:32px;height:38px;font-size:8.5px;padding-bottom:4px">PDF</span>', doc: '<span class="file-ico doc" style="width:32px;height:38px;font-size:8.5px;padding-bottom:4px">DOC</span>', link: `<span class="src-ico">${ic("globe")}</span>` };
    return shell("sources", `
      ${head("Fuentes de datos", "Documentos y páginas web de donde tu asistente también saca respuestas. Las revisamos y te decimos si algo falla.", `<button class="btn btn-primary">${ic("upload", "sm")}Agregar fuente</button>`)}
      <div class="drop" style="margin-bottom:18px"><span class="ico">${ic("upload")}</span><div class="grow"><b>Arrastra archivos aquí</b> <span class="muted">o pega un enlace</span><div class="xs muted">PDF, DOCX o TXT hasta 10 MB · páginas públicas de tu sitio</div></div><div class="row" style="width:min(420px,100%)"><label class="sr" for="srcl">Enlace</label><input id="srcl" class="input" placeholder="https://${D.domain}/..." style="min-height:42px"></div></div>
      <div class="card table-wrap"><table class="table">
        <thead><tr><th>Fuente</th><th>Estado</th><th>Se usa en</th><th><span class="sr">Acciones</span></th></tr></thead>
        <tbody>${D.sources.map((s) => `<tr><td><div class="row">${icon[s.kind]}<div><b style="font-weight:600">${esc(s.title)}</b><div class="xs muted">${s.meta}</div>${s.err ? `<div class="xs" style="color:var(--bad-ink);margin-top:2px">${s.err} Revisa la dirección o quítala.</div>` : ""}</div></div></td>
          <td>${st[s.status]}</td><td>${s.ctx ? `<span class="badge">${ic("link", "sm")}En Contexto: ${s.ctx}</span>` : '<span class="xs muted">Respuestas generales</span>'}</td>
          <td style="text-align:right"><button class="btn btn-ghost btn-sm">${s.status === "error" ? "Reintentar" : "Actualizar"}</button><button class="btn btn-ghost btn-sm">Quitar</button></td></tr>`).join("")}</tbody></table></div>
      <p class="xs muted" style="margin-top:12px">Los archivos que subes dentro de una sección de Contexto no aparecen aquí. Al quitar o actualizar una fuente, también se actualizan las secciones que la usan.</p>`);
  }

  /* ---------- 9. channels ---------- */
  function channels() {
    const soon = [["WhatsApp", "#25D366", waSvg, "Mensajes de tu número de WhatsApp Business."], ["Instagram", "#C13584", igSvg, "Mensajes directos de tu cuenta profesional."], ["Messenger", "#0866FF", msSvg, "Mensajes de tu página de Facebook."]];
    return shell("channels", `
      ${head("Canales", "Conecta dónde te escriben tus clientes. Probamos los datos antes de conectar, así sabes que funcionan.")}
      <div class="ch-grid">
        <section class="card card-pad" aria-labelledby="tgT">
          <div class="row"><span class="ch-logo" style="background:var(--tg)">${tgSvg()}</span><div class="grow"><h2 id="tgT" class="card-title">Telegram</h2><div class="small muted">Tu propio bot. Tus clientes lo encuentran por su nombre o con tu enlace.</div></div><span class="badge good"><span class="dot"></span>Conectado</span></div>
          <div class="notice good" style="margin-top:18px">${ic("check")}<span>Conectado como <b class="mono">${B.bot}</b>. Probamos la conexión y funciona. Último mensaje recibido: hace 3 min.</span></div>
          <dl class="kv" style="margin-top:16px"><dt>Enlace para tus clientes</dt><dd class="mono">t.me/${B.bot.slice(1)}</dd><dt>Nombre del bot</dt><dd>${esc(B.name)} · Ayuda</dd><dt>Foto del bot</dt><dd><span class="row" style="justify-content:flex-end;gap:6px">${logoTile(B, V).replace('class="logo-tile"', 'class="logo-tile" style="width:22px;height:22px"')}Tu logo</span></dd><dt>Conectado el</dt><dd>14 nov 2026</dd></dl>
          <hr class="divider">
          <div class="eyebrow" style="margin-bottom:12px">Cómo se conecta (para cambiar de bot)</div>
          <ol class="howto">
            <li class="done">En Telegram abre <b class="mono">@BotFather</b> y escribe <span class="mono">/newbot</span>.</li>
            <li class="done">Elige el nombre y el usuario de tu bot (debe terminar en «bot»).</li>
            <li>Copia el token que te da BotFather y pégalo aquí. Es como una contraseña: no lo compartas por chat.</li>
          </ol>
          <div class="small muted" style="margin:-4px 0 10px">Token actual: <span class="token-mask" style="padding:3px 8px">7412•••••••••••••Qx</span></div>
          <label class="field"><span class="label">Token nuevo</span><input class="input mono" placeholder="Pega aquí el token de BotFather" autocomplete="off"><span class="hint">Se guarda cifrado y no se vuelve a mostrar.</span></label>
          <div class="row" style="margin-top:16px"><button class="btn btn-ghost">Desconectar</button><span class="grow"></span><button class="btn btn-primary">Conectar y probar</button></div>
          <p class="xs muted" style="margin-top:8px;text-align:right">Al probar, te mandamos un mensaje a tu bot para confirmar que llega a Mensajes.</p>
        </section>
        <div class="stack">
          <div class="eyebrow">Próximamente</div>
          ${soon.map(([n, c, s, d]) => `<div class="card soon-card"><span class="ch-logo" style="background:${c}">${s}</span><div class="grow"><b>${n}</b><div class="small muted">${d}</div></div><span class="badge">Próximamente</span></div>`).join("")}
          <div class="notice info">${ic("clock")}<span class="small">WhatsApp necesita la verificación de tu negocio en Meta. Te avisamos cuando esté listo; tu contexto y tono se usarán igual.</span></div>
        </div>
      </div>`);
  }

  /* ---------- 10. add-ons ---------- */
  function addons() {
    return shell("addons", `
      ${head("Complementos", "Conecta herramientas para que tu asistente haga más cosas.")}
      <div class="notice warn" style="margin-bottom:18px">${ic("alert")}<span>Estás en modo demostración: el asistente NO consulta pedidos reales. Conecta tu tienda para activarlo.</span></div>
      <div class="ch-grid">
        <section class="card card-pad" aria-labelledby="shT">
          <div class="row"><span class="ch-logo" style="background:#5E8E3E">${shopSvg}</span><div class="grow"><h2 id="shT" class="card-title">Shopify</h2><div class="small muted">Tu asistente responderá el estado de los pedidos.</div></div><span class="badge warn"><span class="dot"></span>Modo demostración</span></div>
          <dl class="kv" style="margin-top:18px"><dt>Tienda</dt><dd>Tienda de demostración</dd><dt>Pedidos de prueba</dt><dd class="mono">#1001 a #1004</dd><dt>Permiso</dt><dd>Solo ver pedidos</dd></dl>
          <div class="notice info" style="margin-top:16px">${ic("shield")}<span class="small">Tu asistente solo ve el estado del pedido y el seguimiento. No ve dirección, productos, teléfono ni pagos.</span></div>
          <div class="row" style="margin-top:18px"><button class="btn btn-ghost">Desconectar</button><span class="grow"></span><button class="btn btn-primary">Conectar mi tienda Shopify</button></div>
        </section>
        <div class="stack">
          <section class="card card-pad" aria-labelledby="tryT">
            <h2 id="tryT" class="card-title">Probar con un pedido</h2>
            <p class="small muted" style="margin:4px 0 14px">Lo mismo que hará tu asistente: número y correo deben coincidir.</p>
            <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:10px"><label class="field"><span class="label">Pedido</span><input class="input mono" value="#1001"></label><label class="field"><span class="label">Correo</span><input class="input" value="test@example.com"></label></div>
            <button class="btn btn-secondary btn-block" style="margin-top:12px">Buscar pedido</button>
            <div class="order-card" style="margin-top:14px;padding:14px"><div class="row between"><b class="mono">#1001</b><span class="badge good">Enviado</span></div><div class="small muted" style="margin-top:6px">Guía <span class="mono">EJ123456789MX</span> · Envíos Demo</div></div>
          </section>
          <div class="card soon-card"><span class="ch-logo" style="background:#F22F46">${ic("phone")}</span><div class="grow"><b>Twilio</b><div class="small muted">Llamadas y SMS con Twilio.</div></div><span class="badge">Próximamente</span></div>
        </div>
      </div>`);
  }

  /* ---------- 11. brand ---------- */
  let draft = { ...B };
  function brand() {
    return shell("brand", `
      ${head("Marca", "Tu logo y tus colores en el panel de tu equipo y en la foto de tu bot. Nosotros cuidamos que los textos se lean bien.")}
      <div class="brand-grid">
        <section class="card card-pad" id="brForm">${brandForm(draft, "br-")}
          <div class="row" style="margin-top:20px"><button class="btn btn-ghost" id="brReset">${ic("reset", "sm")}Restablecer</button><span class="grow"></span><button class="btn btn-primary" id="brSave">Guardar marca</button></div>
        </section>
        <section aria-label="Vista previa">
          <div class="row between" style="margin-bottom:10px"><b>Vista previa en vivo</b><span class="xs muted">Cambia un color y mira</span></div>
          <div id="brPv">${preview(draft)}</div>
          <div class="card card-pad" style="margin-top:16px"><div class="row">${ic("eye")}<div class="grow small"><b>Dónde se ve tu marca</b><div class="muted">Panel de tu equipo · foto y nombre de tu bot en Telegram · chat para tu sitio web (próximamente). Las pantallas de Conversa para crear cuenta no cambian.</div></div></div></div>
        </section>
      </div>`);
  }

  /* ---------- 12. team ---------- */
  function team() {
    const seats = 5, used = DATA.team.length, pend = DATA.invites.length;
    return shell("team", `
      ${head("Equipo", "Invita a quienes atienden a tus clientes. Cada quien entra con su propia cuenta.")}
      <div class="ch-grid team-grid">
        <section class="card table-wrap" aria-label="Miembros">
          <table class="table"><thead><tr><th>Persona</th><th>Rol</th><th>Actividad</th><th><span class="sr">Acciones</span></th></tr></thead><tbody>
          ${DATA.team.map((m) => `<tr><td><div class="row"><span class="avatar">${m.initials}</span><div><b style="font-weight:600">${m.name}</b>${m.you ? ' <span class="badge" style="height:20px">Tú</span>' : ""}<div class="xs muted">${m.email}</div></div></div></td>
            <td><label class="sr" for="r-${m.initials}">Rol de ${m.name}</label><select id="r-${m.initials}" class="input" style="min-height:36px;width:auto;padding:4px 10px" ${m.you ? "disabled" : ""}><option ${m.role === "Admin" ? "selected" : ""}>Admin</option><option ${m.role === "Agente" ? "selected" : ""}>Agente</option></select></td>
            <td class="small muted">${m.last}</td><td style="text-align:right">${m.you ? "" : '<button class="btn btn-ghost btn-sm">Quitar</button>'}</td></tr>`).join("")}
          ${DATA.invites.map((m) => `<tr><td><div class="row"><span class="avatar" style="background:var(--b-softer);color:var(--b-tint-ink);border:1px dashed var(--b-tint-ink)">${ic("mail", "sm")}</span><div><b style="font-weight:600">${m.email}</b><div class="xs muted">Invitación enviada ${m.sent}</div></div></div></td><td class="small">${m.role}</td><td><span class="badge warn">Pendiente</span></td><td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-sm">Reenviar</button><button class="btn btn-ghost btn-sm">Cancelar</button></td></tr>`).join("")}
          </tbody></table>
          <div style="padding:16px 18px;border-top:1px solid var(--line)" class="small muted"><b style="color:var(--ink)">Admin</b>: todo, incluida la marca, el plan y el equipo. <b style="color:var(--ink)">Agente</b>: Mensajes y Probar mi asistente.</div>
        </section>
        <div class="stack">
          <section class="card card-pad" aria-labelledby="invT">
            <h2 id="invT" class="card-title">Invitar a alguien</h2>
            <form class="stack" style="margin-top:12px" onsubmit="return false">
              <label class="field"><span class="label">Correo</span><input class="input" type="email" placeholder="nombre@example.com"></label>
              <label class="field"><span class="label">Rol</span><select class="input"><option>Agente</option><option>Admin</option></select></label>
              <button class="btn btn-primary btn-block">Enviar invitación</button>
            </form>
          </section>
          <section class="card card-pad" aria-labelledby="seT">
            <div class="row between"><h2 id="seT" class="card-title">Lugares del plan</h2><span class="small"><b>${used + pend} de ${seats}</b> <span class="muted">· Plan Pro</span></span></div>
            <div class="seat-bar" style="margin:14px 0 10px" aria-hidden="true">${Array.from({ length: seats }, (_, i) => `<i class="${i < used ? "on" : i < used + pend ? "pend" : ""}"></i>`).join("")}</div>
            <div class="xs muted">${used} en uso · ${pend} invitación pendiente · ${seats - used - pend} libre</div>
            <a class="small" href="${qs()}#billing" style="display:inline-block;margin-top:12px;font-weight:600">Ver plan y uso</a>
          </section>
        </div>
      </div>`);
  }

  /* ---------- 13. billing ---------- */
  function billing() {
    const plans = [
      ["Gratis", "Para probar con tu propio bot.", ["1 canal (Telegram)", "100 conversaciones al mes", "1 persona del equipo", "Tienda de demostración"]],
      ["Pro", "Para negocios que ya atienden todos los días.", ["Telegram, y WhatsApp cuando esté listo", "1,000 conversaciones al mes", "Hasta 5 personas", "Shopify y tu marca"], true],
      ["Negocio", "Para equipos grandes o varias sucursales.", ["Todos los canales", "Conversaciones a la medida", "Personas ilimitadas", "Ayuda para configurar"]],
    ];
    const meter = (label, used, total, unit, pct, note) => `<div><div class="row between"><b>${label}</b><span class="small"><b>${used}</b> <span class="muted">de ${total} ${unit}</span></span></div><div class="meter" style="margin:10px 0 6px;height:10px"><i style="width:${pct}%"></i></div><div class="xs muted">${note}</div></div>`;
    return shell("billing", `
      ${head("Plan y uso", "Cuánto has usado este mes y qué incluye tu plan.")}
      <div class="notice info" style="margin-bottom:18px">${ic("card")}<span class="small">Los cobros aún no están activos. Los precios están por definir; por ahora todos los planes son de prueba.</span></div>
      <section class="card card-pad" aria-labelledby="usT" style="margin-bottom:18px">
        <div class="row between"><h2 id="usT" class="card-title">Uso de noviembre</h2><span class="small muted">Se renueva el 1 de diciembre</span></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:18px" class="usage-grid">
          ${meter("Conversaciones", "412", "1,000", "", 41, "Cuentan las de clientes reales; las del simulador no.")}
          ${meter("Uso de IA", "42%", "tu tope mensual", "", 42, "Al llegar al tope, el asistente pasa los mensajes nuevos a tu equipo. Nunca te cobramos de más.")}
          ${meter("Personas del equipo", "4", "5", "", 80, "3 activas y 1 invitación pendiente.")}
        </div>
      </section>
      <div class="plans">${plans.map(([n, d, f, cur]) => `<article class="card plan ${cur ? "current" : ""}">
        <div class="row between"><h3>${n}</h3>${cur ? '<span class="badge brand">Tu plan</span>' : ""}</div>
        <p class="small muted">${d}</p>
        <div class="price-tbd">Precio por definir</div>
        <ul>${f.map((x) => `<li>${ic("check", "sm")}${x}</li>`).join("")}</ul>
        <span class="grow"></span>
        ${cur ? '<button class="btn btn-secondary btn-block" disabled>Plan actual</button>' : n === "Negocio" ? '<button class="btn btn-primary btn-block">Hablar con nosotros</button>' : '<button class="btn btn-secondary btn-block">Cambiar a Gratis</button>'}
      </article>`).join("")}</div>`);
  }

  /* ---------- 14. platform admin ---------- */
  function admin() {
    const pvv = vars(PLATFORM);
    const tl = (t) => {
      const b = t.brand && BRANDS[t.brand];
      return b ? logoTile(b, vars(b)) : otherLogo(t);
    };
    const stB = { "Activo": "good", "Configurando": "info", "Tope de IA": "warn", "Pausado": "" };
    const chB = { ok: "good", off: "", warn: "good", err: "bad" };
    const total = DATA.tenants.reduce((a, t) => a + t.convs, 0);
    const spark = (seed) => `<span class="spark" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i style="height:${4 + ((seed * (i + 3)) % 17)}px"></i>`).join("")}</span>`;
    return `<div class="platform">
      <header class="admin-top">
        <div class="p-logo">${logoTile(PLATFORM, pvv)}<b>Conversa</b><span class="prov">${PLATFORM.provisional}</span></div>
        <nav class="admin-tabs" aria-label="Administración"><a href="#" aria-current="page">Clientes</a><a href="#">Uso de IA</a><a href="#">Estado del sistema</a><a href="#">Auditoría</a></nav>
        <span class="grow"></span>
        <label class="sr" for="asw">Entrar como cliente</label>
        <select id="asw"><option>Entrar como cliente…</option>${DATA.tenants.map((t) => `<option>${t.name}</option>`).join("")}</select>
        <span class="avatar" style="background:#1C302D;color:#E6F2F0">CV</span>
      </header>
      <main class="content wide" style="max-width:1400px;margin:0 auto">
        ${head("Clientes", "Todos los negocios en la plataforma. Esta vista usa la marca de Conversa, nunca la de un cliente.", `<button class="btn btn-primary">${ic("sparkle", "sm")}Crear cliente</button>`)}
        <div class="kpis">
          <div class="card kpi"><span class="eyebrow">Clientes activos</span><div class="num">4</div><div class="lbl">de ${DATA.tenants.length} registrados</div></div>
          <div class="card kpi"><span class="eyebrow">Conversaciones · noviembre</span><div class="num">${total.toLocaleString("es-MX")}</div><div class="lbl">en todos los clientes</div></div>
          <div class="card kpi"><span class="eyebrow">Uso de IA de la plataforma</span><div class="num">38<span style="font-size:20px">%</span></div><div class="meter neutral" style="margin:4px 0 8px"><i style="width:38%"></i></div><div class="lbl">del límite de gasto mensual</div></div>
          <div class="card kpi alert"><span class="eyebrow" style="color:var(--s-need)">Requieren atención</span><div class="num">2</div><div class="lbl">1 en su tope de IA · 1 bot con error</div></div>
        </div>
        <div class="card table-wrap">
          <div class="row" style="padding:14px 16px;border-bottom:1px solid var(--line)"><div style="position:relative;width:320px"><span style="position:absolute;left:12px;top:12px;color:var(--muted)">${ic("search", "sm")}</span><label class="sr" for="ts">Buscar cliente</label><input id="ts" class="input" placeholder="Buscar negocio..." style="padding-left:36px;min-height:40px"></div><span class="grow"></span><div class="filters" style="padding:0"><button aria-pressed="true">Todos</button><button aria-pressed="false">Activos</button><button aria-pressed="false">Requieren atención</button></div></div>
          <table class="table"><thead><tr><th>Negocio</th><th>Plan</th><th>Estado</th><th>Canal</th><th style="text-align:right">Conversaciones del mes</th><th>Uso de IA</th><th>Equipo</th><th><span class="sr">Acciones</span></th></tr></thead><tbody>
          ${DATA.tenants.map((t, i) => `<tr><td><div class="tn">${tl(t)}<div><b style="font-weight:600">${t.name}</b>${t.tag ? ` <span class="xs muted">(${t.tag})</span>` : ""}<div class="xs muted">Desde ${t.since}</div></div></div></td>
            <td>${t.plan}</td><td><span class="badge ${stB[t.status]}"><span class="dot"></span>${t.status}</span></td>
            <td>${t.ch === "off" ? '<span class="xs muted">Sin conectar</span>' : `<span class="badge ${t.ch === "err" ? "bad" : "tg"}">${t.ch === "err" ? "Telegram · error" : "Telegram"}</span>`}</td>
            <td style="text-align:right"><span class="row" style="justify-content:flex-end">${spark(i + 3)}<b class="mono" style="font-size:13.5px;min-width:46px;text-align:right">${t.convs.toLocaleString("es-MX")}</b></span></td>
            <td style="min-width:150px"><div class="row" style="gap:8px"><div class="meter neutral grow" style="height:6px"><i style="width:${t.ai}%;${t.ai >= 100 ? "background:var(--warn)" : ""}"></i></div><span class="xs mono">${t.ai}%</span></div></td>
            <td class="small">${t.members}</td><td style="text-align:right"><button class="btn btn-ghost btn-sm">Ver</button></td></tr>`).join("")}
          </tbody></table>
        </div>
        <p class="xs muted" style="margin-top:12px">Por privacidad, aquí no se muestran mensajes ni datos de los clientes finales: solo conteos.</p>
      </main>
    </div>`;
  }

  /* ---------- router + wiring ---------- */
  const ROUTES = { signup, onboarding, dashboard, inbox, simulator, context, tone: toneScreen, sources, channels, addons, brand, team, billing, "platform-admin": admin };
  function protoBar(r) {
    return `<div class="proto" aria-label="Controles del prototipo">Prototipo
      <label class="sr" for="pb">Marca</label><select id="pb">${Object.keys(BRANDS).map((k) => `<option value="${k}" ${k === brandId ? "selected" : ""}>${BRANDS[k].name}</option>`).join("")}</select>
      <label class="sr" for="ps">Pantalla</label><select id="ps">${Object.keys(ROUTES).map((k) => `<option ${k === r ? "selected" : ""}>${k}</option>`).join("")}</select></div>`;
  }
  function render() {
    const r = location.hash.slice(1) || "dashboard";
    const fn = ROUTES[r] || dashboard;
    app.innerHTML = fn() + protoBar(r);
    wire(r);
    window.scrollTo(0, 0);
  }
  function wire(r) {
    const $ = (s) => app.querySelector(s);
    $("#pb").onchange = (e) => (location.search = `?brand=${e.target.value}`);
    $("#ps").onchange = (e) => (location.hash = e.target.value);
    const tb = $("#tenantBtn");
    if (tb) tb.onclick = () => { const p = $("#tenantPop"); p.hidden = !p.hidden; tb.setAttribute("aria-expanded", String(!p.hidden)); };
    const mb = $("#menuBtn");
    if (mb) mb.onclick = () => $("#side").classList.toggle("open");
    if (r === "inbox") {
      app.querySelectorAll(".conv").forEach((el) => {
        const go = () => { openId = el.dataset.id; render(); app.querySelector("#inboxView").classList.add("has-open"); };
        el.onclick = go; el.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), go());
      });
      app.querySelectorAll("[data-f]").forEach((el) => (el.onclick = (e) => { e.preventDefault(); filter = el.dataset.f; render(); }));
      const m = $("#msgs"); m.scrollTop = m.scrollHeight;
      $("#replyBtn").onclick = () => {
        const t = $("#reply").value.trim(); if (!t) return;
        const c = D.convs.find((x) => x.id === openId); c.status = "human"; c.agent = "Mariana"; delete c.reason; c.urgent = false; c.prev = "Tú: " + t;
        if (openId === "c1") D.thread.push({ from: "agent", who: "Mariana López", t, at: "ahora" });
        render();
      };
      $("#returnBtn").onclick = () => { const c = D.convs.find((x) => x.id === openId); c.status = "bot"; delete c.reason; c.urgent = false; c.agent = null; render(); };
      $("#resolveBtn").onclick = () => { const c = D.convs.find((x) => x.id === openId); c.status = "resolved"; delete c.reason; c.urgent = false; render(); };
    }
    if (r === "simulator") {
      const send = (txt) => {
        if (!txt) return;
        simLog.push({ me: true, t: txt });
        const hit = SIM[txt];
        if (hit) simLog.push({ t: hit[0], handoff: hit[1] === "handoff" });
        else if (/@/.test(txt)) simLog.push({ t: "¡Gracias! Tu pedido #1001 ya fue enviado.", order: true });
        else simLog.push({ t: "No tengo ese dato. Si quieres, te paso con una persona del equipo." });
        $("#simMsgs").innerHTML = simMsgs(); $("#simMsgs").scrollTop = 1e6;
      };
      app.querySelectorAll(".chip").forEach((el) => (el.onclick = () => send(el.dataset.s)));
      $("#simForm").onsubmit = (e) => { e.preventDefault(); send($("#simIn").value.trim()); $("#simIn").value = ""; };
      $("#simReset").onclick = () => { simLog = []; $("#simMsgs").innerHTML = `<p class="small muted" style="text-align:center;margin:auto">Toca un ejemplo o escribe tu propio mensaje.</p>`; };
    }
    if (r === "tone") {
      const names = ["Formal", "Cortés", "Cercano", "Amigable", "Muy amigable"];
      $("#toneR").oninput = (e) => {
        tone = +e.target.value;
        $("#toneP").innerHTML = toneSamples(); $("#tnNum").textContent = tone;
        $("#tnLbl").textContent = `Nivel ${tone} de 5 · ${names[tone - 1]}`; e.target.setAttribute("aria-valuetext", names[tone - 1]);
        app.querySelectorAll("#ticks span").forEach((s, i) => s.toggleAttribute("aria-current", i + 1 === tone));
      };
    }
    if (r === "context") {
      app.querySelectorAll(".seg").forEach((g) => g.querySelectorAll("button").forEach((b) => (b.onclick = () => g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))))));
    }
    if (r === "brand" || r === "onboarding") {
      const isB = r === "brand";
      const state = isB ? draft : B;
      const form = $(isB ? "#brForm" : "#obForm"), pvBox = $(isB ? "#brPv" : "#obPv"), cr = $(isB ? "#br-contrast" : "#ob-contrast");
      wireBrandForm(form, state, () => { pvBox.innerHTML = preview(state); cr.innerHTML = contrastReport(state); form.querySelector(".logo-drop .logo-tile").innerHTML = Color.logoSvg(state, vars(state)); });
      if (isB) {
        $("#brReset").onclick = () => { draft = { ...BRANDS[brandId] }; render(); };
        $("#brSave").onclick = () => { B = { ...draft }; V = vars(B); applyVars(document.documentElement, V); render(); };
      }
    }
    app.querySelectorAll(".opt").forEach((o) => (o.onclick = () => o.parentElement.querySelectorAll(".opt").forEach((x) => x.setAttribute("aria-pressed", String(x === o)))));
  }
  window.addEventListener("hashchange", render);
  render();
})();
