import { useSession } from "@/store/session";

/** Who sells (D375): leadership and everybody with marketing access, as well
 *  as the project people. The screens' copy of `ops_procure.may_sell` (0219):
 *  project **or** marketing access at this level. Order lines are not sales —
 *  they stay `project.update`. */
export function useCanSell(): (level?: "read" | "update" | "create") => boolean {
  const { can } = useSession();
  return (level = "update") => can(`project.${level}`) || can(`marketing.${level}`);
}

/** Who works on a project's design (0222's `may_design`): whoever sells, and
 *  the drafters, who hold the production module. */
export function useCanDesign(): (level?: "read" | "update" | "create") => boolean {
  const { can } = useSession();
  const canSell = useCanSell();
  return (level = "update") => canSell(level) || can(`production.${level}`);
}
