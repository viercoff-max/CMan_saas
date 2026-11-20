// Setup checklist rules (pure, tested). Agents only see steps they can do (the simulator); admins see everything.
// Exactly ONE primary button: the first unfinished required step ("next-step-primary" rule).
import type { Role } from "@/lib/auth/roles";

export interface StepState {
  context: boolean; tone: boolean; sources: boolean; tested: boolean; channels: boolean;
  team: boolean; brand: boolean; shop: boolean; shopDemo: boolean;
  /** Invitations exist only in Supabase mode. */
  canInvite: boolean;
}
export interface Step { id: string; href: string; label: string; done: boolean; optional: boolean; admin: boolean }

export function buildSteps(role: Role, st: StepState): { steps: Step[]; nextIdx: number } {
  const all: Step[] = [
    { id: "context", href: "/context", label: "dash.step.context", done: st.context, optional: false, admin: true },
    { id: "tone", href: "/tone", label: "dash.step.tone", done: st.tone, optional: false, admin: true },
    { id: "sources", href: "/sources", label: "dash.step.sources", done: st.sources, optional: false, admin: true },
    // Testing the simulator comes before connecting real channels.
    { id: "test", href: "/inbox?simulator=1", label: "dash.step.test", done: st.tested, optional: false, admin: false },
    { id: "channels", href: "/channels", label: "dash.step.channelsAny", done: st.channels, optional: false, admin: true },
    ...(st.canInvite ? [{ id: "team", href: "/team", label: "dash.step.team", done: st.team, optional: false, admin: true }] : []),
    { id: "brand", href: "/brand", label: "dash.step.brand", done: st.brand, optional: true, admin: true },
    { id: "addons", href: "/addons", label: "dash.step.addons", done: st.shop && !st.shopDemo, optional: true, admin: true },
  ];
  const isAdmin = role === "owner" || role === "admin";
  const steps = all.filter((s) => isAdmin || !s.admin);
  return { steps, nextIdx: steps.findIndex((x) => !x.done && !x.optional) };
}
