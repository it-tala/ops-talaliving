# Phase 2 · Authentication — the settings that live outside the repository

Everything else in this project is in migrations, in `src`, or in a check that
refuses. This is the exception, and it is worth naming as one: **four
authentication settings live in the Supabase dashboard, they are not in any
file here, and one of them locked the first administrator out for three weeks.**

## The failure, exactly

`superadmin@talaliving.com` was created 2026-08-26. On 2026-09-18 it had eleven
modules at `admin`, a profile row, a confirmed address — and no password anybody
knew. The dashboard's *Send password recovery* worked: the mail arrived, the
token verified, GoTrue minted a session, and the browser was then redirected to

    http://localhost:3000/#access_token=…&type=recovery

a machine nobody was sitting at. The session existed for about a second in an
address bar and was never used. `auth.users` records both halves of it —
`recovery_sent_at` at 09:17:24, `last_sign_in_at` twenty-four seconds later.

Two separate faults, and fixing either alone fixes nothing:

1. **Site URL still said `localhost`.** Every recovery, invitation and magic
   link Supabase sends points there.
2. **The application had no page to land on.** Even aimed correctly, the link
   would have arrived somewhere that does nothing with a recovery fragment.

Fault 2 is fixed in code — `/set-password`, and the *lupa kata sandi* link on
`/signin` that asks for a link carrying this origin. Fault 1 cannot be: it is a
project setting, and it has to be set by somebody with the dashboard open.

## What to set — Authentication → URL Configuration

| Setting | Value |
|---|---|
| **Site URL** | `https://ops.talaliving.com` |
| **Redirect URLs** | `https://ops.talaliving.com/**`, `http://localhost:3000/**`, and the preview origin |

Site URL is the fallback the mail templates use; the redirect list is what
`redirectTo` is checked against. The application always sends its own
`redirectTo` (`window.location.origin + "/set-password"`), so preview and
production each get their own correct link — but only if both origins are in
the list. An origin that is not in it is silently replaced by Site URL, which
is the failure above wearing a different hat.

The preview origin is a `workers.dev` address — `wrangler versions upload`
prints it at the end of every non-`main` build, shaped
`https://<version>-ops-talaliving.<subdomain>.workers.dev`. Copy the subdomain
from one of those logs and add `https://*-ops-talaliving.<subdomain>.workers.dev/**`.
Guessing it is not worth it: a redirect URL that does not match is not an error,
it is a silent fall back to Site URL.

Keep `http://localhost:3000` in the list. Local development needs it, and it is
only reachable by somebody already at that machine.

## The first password, before any of this is in place

A chicken-and-egg: the recovery flow needs a deployment, and reaching the
deployment needs a password. Set one directly, in the SQL editor, **typed by
the person who will use it** — nowhere else, and not in a chat window:

```sql
update auth.users
   set encrypted_password = extensions.crypt('…', extensions.gen_salt('bf')),
       updated_at         = now()
 where email = 'superadmin@talaliving.com';
```

GoTrue reads bcrypt, so this is a password like any other. It is a one-time
measure for the first account: after it, `/signin` → *lupa kata sandi* is the
route for everybody, including this one.

It does **not** work for an account that does not exist yet. `ops_core.users.id`
is a foreign key to `auth.users(id)`, so a person has to exist in GoTrue before
they can have a profile — which is why the nine `chat_users` in
`supabase/import/README.md` are held: importing them means inviting them.

## Email delivery is not configured, and the default will not carry this

Supabase's built-in mail service is rate-limited to a few messages an hour and
is intended for development. Nine invitations plus the ordinary trickle of
forgotten passwords is past what it will do, and the failure mode is the worst
available: `resetPasswordForEmail` returns success, and no mail arrives.

Before the nine are invited, Authentication → Emails → SMTP needs a real
sender — the Google Workspace this business already has, or a transactional
provider. `requestPasswordReset` returns a 500 only when the server refuses the
request outright; a mail accepted and then dropped looks like success from here,
because from here it is.

## What is deliberately still manual

Granting modules is in the application (`/it/pengguna`), and creating accounts
is not. That is D24 rather than an omission: a sign-up form is a door into a
workspace nobody invited anybody to. Inviting a person is a decision about a
person, and it stays with whoever is allowed to make it.
