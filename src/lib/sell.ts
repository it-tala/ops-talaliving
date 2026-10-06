import { useSession } from "@/store/session";

/** Who sells (D375): leadership and everybody with marketing access, as well
 *  as the project people. The screens' copy of `ops_procure.may_sell` (0219):
 *  project **or** marketing access at this level. Order lines are not sales —
 *  they stay `project.update`. */
export function useCanSell(): (level?: "read" | "update" | "create") => boolean {
  const { can } = useSession();
  return (level = "update") => can(`project.${level}`) || can(`marketing.${level}`);
}
