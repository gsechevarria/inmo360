import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { Shell } from "@/components/Shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [pref, synth] = await withUser(user.id, async (tx) => Promise.all([
    tx`select active_strategy from app.preferences where user_id = ${user.id}`,
    tx`select exists(select 1 from market.listings where is_synthetic) as s`,
  ]));
  return <Shell user={user} strategy={pref[0]?.active_strategy ?? "rent_long"} synthetic={!!synth[0]?.s}>{children}</Shell>;
}
