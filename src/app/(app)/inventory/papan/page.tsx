import { redirect } from "next/navigation";

/** Sawn boards merged into the timber module (owner, D202).
 *
 *  They were two screens because the data was two tables. They are one module
 *  because they are one piece of wood: a load of logs, the boards it became,
 *  and where those boards went. Splitting them meant the rendemen lived on one
 *  screen and the rack on another, and nobody could see that the second was
 *  not stock at all.
 *
 *  The route stays and redirects rather than 404s — it is in people's history.
 */
export default function BoardsPage() {
  redirect("/inventory/log");
}
