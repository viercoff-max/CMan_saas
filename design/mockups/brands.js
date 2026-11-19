/* Brand configs + color math for the Conversa prototype (mockup only).
 * To add or change a brand, edit BRANDS below. Every tenant screen reads from it.
 * Logos are inline SVG strings; {{primary}}, {{accent}}, {{onPrimary}} are replaced at render time,
 * so a logo follows the brand colors (also in the live preview on #brand and #onboarding). */

window.BRANDS = {
  chefman: {
    id: "chefman",
    name: "Chefman",
    tag: "marca de prueba",
    industry: "Electrodomésticos de cocina",
    primary: "#B42318",   // warm red
    accent: "#2E2B29",    // charcoal
    background: "#FBF5F3", // tint for sidebar / soft surfaces
    font: "Bricolage Grotesque",
    agent: "Chema",
    bot: "@ChefmanAyudaBot",
    // Original placeholder glyph: a frying pan with steam. Not the real Chefman logo.
    logo: `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="{{primary}}"/>
      <path d="M6.5 21h19v1.2a6.3 6.3 0 0 1-6.3 6.3h-6.4a6.3 6.3 0 0 1-6.3-6.3z" fill="{{onPrimary}}"/>
      <path d="M25.5 22.6h8" stroke="{{onPrimary}}" stroke-width="3" stroke-linecap="round"/>
      <path d="M11.5 10c-1.4 1.6 1.4 2.8 0 4.6M16 8.6c-1.4 1.6 1.4 2.8 0 4.6M20.5 10c-1.4 1.6 1.4 2.8 0 4.6" fill="none" stroke="{{onPrimary}}" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`,
  },
  aurora: {
    id: "aurora",
    name: "Café Aurora",
    tag: "",
    industry: "Cafetería y tostador",
    primary: "#E9A23B",   // sunrise amber: light, so buttons get dark text automatically
    accent: "#3E2A4F",    // dusk plum
    background: "#F6F2F8",
    font: "Fraunces",
    agent: "Alba",
    bot: "@CafeAuroraBot",
    logo: `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="40" height="40" rx="20" fill="{{accent}}"/>
      <path d="M12 21h16v3.5a8 8 0 0 1-16 0z" fill="#fff"/>
      <path d="M28 22.5h1.6a2.6 2.6 0 0 1 0 5.2H27" fill="none" stroke="#fff" stroke-width="1.8"/>
      <path d="M14.5 19a5.5 5.5 0 0 1 11 0z" fill="{{primary}}"/>
      <path d="M20 9.5v3M13.6 12.2l1.8 2.2M26.4 12.2l-1.8 2.2" stroke="{{primary}}" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`,
  },
};

// The platform's own identity (only on sign-up, onboarding chrome and platform admin).
window.PLATFORM = {
  name: "Conversa",
  provisional: "nombre provisional",
  primary: "#0F766E",
  accent: "#14181F",
  background: "#F1F6F5",
  font: "Bricolage Grotesque",
  logo: `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="40" height="40" rx="11" fill="{{accent}}"/>
    <path d="M10 13.5a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-6l-4.5 3.6v-3.7A4 4 0 0 1 10 18.5z" fill="{{primary}}"/>
    <path d="M18 23.5h7.5l4.5 3.6v-3.7a3.6 3.6 0 0 0 0-.4V18" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
  </svg>`,
};

/* ---------- color math (WCAG 2.x relative luminance) ---------- */
(function () {
  const hex = (h) => {
    let s = String(h).replace("#", "").trim();
    if (s.length === 3) s = s.split("").map((c) => c + c).join("");
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
  const lum = (h) => {
    const [r, g, b] = hex(h).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const mix = (a, b, t) => {
    const A = hex(a), B = hex(b);
    return toHex(A.map((v, i) => v + (B[i] - v) * t));
  };
  // Darken (or lighten) `c` until it reaches `ratio` against `bg`.
  const ensure = (c, bg, ratio = 4.5) => {
    const target = lum(bg) > 0.4 ? "#000000" : "#FFFFFF";
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const m = mix(c, target, t);
      if (contrast(m, bg) >= ratio) return m;
    }
    return target;
  };
  // Text that sits ON a filled color: white or near-black, whichever passes AA (prefers white on ties).
  const onColor = (c) => {
    const w = contrast("#FFFFFF", c), k = contrast("#16121A", c);
    if (w >= 4.5) return "#FFFFFF";
    if (k >= 4.5) return "#16121A";
    return w >= k ? "#FFFFFF" : "#16121A";
  };

  /** Derive every CSS token the UI needs from a brand config. */
  function derive(b) {
    const primary = b.primary.toUpperCase();
    const onPrimary = onColor(primary);
    const ink = ensure(primary, "#FFFFFF", 4.5); // brand color safe for text/links/focus on white
    const tint = b.background || mix(primary, "#FFFFFF", 0.95);
    const tintInk = ensure(primary, tint, 4.5);
    return {
      "--b-primary": primary,
      "--b-on-primary": onPrimary,
      "--b-primary-hover": mix(primary, onPrimary === "#FFFFFF" ? "#000000" : "#000000", 0.12),
      "--b-ink": ink,
      "--b-tint-ink": tintInk,
      "--b-soft": mix(primary, "#FFFFFF", 0.88),
      "--b-softer": mix(primary, "#FFFFFF", 0.94),
      "--b-accent": b.accent,
      "--b-on-accent": onColor(b.accent),
      "--b-tint": tint,
      "--b-tint-line": mix(tint, "#000000", 0.07),
      "--b-font": `"${b.font || "Bricolage Grotesque"}"`,
      _report: {
        onPrimary,
        buttonRatio: contrast(onPrimary, primary),
        ink,
        inkRatio: contrast(ink, "#FFFFFF"),
        inkAdjusted: ink !== primary,
        accentRatio: contrast(onColor(b.accent), b.accent),
      },
    };
  }
  function logoSvg(b, v) {
    const d = v || derive(b);
    return b.logo
      .replaceAll("{{primary}}", d["--b-primary"])
      .replaceAll("{{accent}}", b.accent)
      .replaceAll("{{onPrimary}}", d["--b-on-primary"]);
  }
  window.Color = { hex, toHex, lum, contrast, mix, ensure, onColor, derive, logoSvg };
})();
