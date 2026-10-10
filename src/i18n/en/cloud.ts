/**
 * Cloud sync (Supabase) — English side of the `cloud` namespace.
 * Shape must match `src/i18n/zh/cloud.ts` exactly (the type system enforces it).
 */
import type { cloud as zhCloud } from '../zh/cloud'

export const cloud: typeof zhCloud = {
  /* ---------------- panel ---------------- */
  title: 'Cloud sync',
  desc:
    'Keep your phone and computer on the same data. Everything is still stored on this device — ' +
    'the cloud holds a copy, so you can keep working offline or signed out.',

  /* ---------------- not configured ---------------- */
  notConfiguredTitle: 'Cloud sync is not configured',
  notConfiguredBody:
    'This build has no Supabase URL or anon key, so cloud sync is switched off entirely. ' +
    'Local storage works exactly as before. To turn it on, do these four steps:',
  notConfiguredWhere:
    'Set those two variables and restart the dev server — the sign-in form will then appear right here.',
  notConfiguredStep1: 'Create a project on supabase.com (the free tier is plenty)',
  notConfiguredStep2:
    'Run supabase/schema.sql from this repo in the project SQL Editor (table + access rules)',
  notConfiguredStep3:
    'Enable Email sign-in under Authentication, and decide on "Confirm email" as described in the guide',
  notConfiguredStep4:
    'Put the Project URL and anon key in .env.local (local dev) or repo Secrets (deploys), then rebuild',
  notConfiguredDocsLead: 'Step-by-step guide (including where to click): ',
  notConfiguredDocsFile: 'docs/supabase-接入步骤.md',
  notConfiguredShort:
    'Cloud sync is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing).',
  problemPlaceholder:
    'These still look like the sample values from .env.example. Replace the xxxx with your own ' +
    'Project URL and key, then restart the dev server.',
  problemSecretTitle: 'Danger: that is a Secret key — it must not go into a web page',
  problemSecretBodyA: 'That key can ',
  problemSecretBodyBold: 'bypass the database access rules',
  problemSecretBodyC:
    ' (RLS) and read everyone’s data, and front-end code is shipped inside the page JS where ' +
    'anyone can read it. If you have already deployed it anywhere, revoke it under API Keys in ' +
    'the Supabase dashboard and generate a new one — revoking is the only remedy once it has been ' +
    'published. The key you want is the Publishable key (called anon / public in the older ' +
    'dashboard); they are the same role. Cloud sync has been switched off because of this; local ' +
    'features are unaffected.',

  /* ---------------- sign in ---------------- */
  signInTitle: 'Sign in to the same account',
  signInDesc:
    'Sign in with the same email on your phone and your computer and the two will sync. Register first if this is new.',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  passwordLabel: 'Password',
  passwordPlaceholder: 'at least 6 characters',
  passwordHint:
    'Your email and password go to Supabase only — never anywhere else, and never into an exported backup.',
  signIn: 'Sign in',
  signUp: 'Register',
  signingIn: 'Signing in…',
  signingUp: 'Registering…',
  signInOk: 'Signed in. Syncing…',
  signUpOk: 'Registered and signed in.',
  signUpNeedConfirm:
    'Registered. Open the confirmation link in your inbox and then sign in — your project has ' +
    '"Confirm email" turned on, so Supabase will not hand out a session until you do.',
  signOut: 'Sign out',
  loggedOutToast: 'Signed out. Nothing was deleted from this device.',
  signedInAs: 'Signed in as ',

  /* ---------------- status ---------------- */
  statusLabel: 'Status',
  statusOff: 'Signed out',
  statusIdle: 'Up to date',
  statusSyncing: 'Syncing…',
  statusError: 'Sync failed',
  statusOutdated: 'App update required',
  statusPending: 'Changes waiting to sync',
  lastSyncLabel: 'Last sync',
  neverSynced: 'Never synced yet',
  syncNow: 'Sync now',
  deviceLabel: 'This device',
  deviceHint:
    'Each device has its own id. Different ids on two devices is normal — it only tells the app ' +
    'whether the copy in the cloud is the one it just pushed, so nothing gets pushed back and forth.',

  /* ---------------- errors ---------------- */
  errorBadCredentials: 'Wrong email or password.',
  errorEmailNotConfirmed:
    'This email is not confirmed yet. Open the confirmation link in your inbox, then sign in.',
  errorAlreadyRegistered:
    'That email is already registered. Just sign in; if you forgot the password, reset it under ' +
    'Authentication in the Supabase dashboard.',
  errorWeakPassword: 'That password is too short — at least 6 characters.',
  errorRateLimited: 'Too many requests. Supabase is throttling for a moment; try again in a few minutes.',
  errorSignupDisabled: 'This project has sign-ups disabled. Sign in with an existing account.',
  errorBadEmail: 'That does not look like a valid email address.',
  errorNetwork:
    'Cannot reach the cloud. Your local data is unaffected and it will sync again once you are ' +
    'back online. If it keeps failing, your network probably cannot reach the {host} domain ' +
    '(a different domain from the dashboard, and easily at odds with proxy settings) — open ' +
    '{host}/rest/v1/ in your browser to check, or run npm run check:supabase for details.',
  errorNoTable:
    'The cloud table does not exist yet. Run supabase/schema.sql in your Supabase SQL Editor.',
  errorGeneric: 'Sync failed: {message}',
  outdated:
    'The copy in the cloud comes from a newer version of this app. Update the app (or upgrade on the ' +
    'device that wrote it) before syncing — forcing it now would drop fields this version does not know.',
  detailLabel: 'Technical detail',
  detailShow: 'Show',
  detailHide: 'Hide',

  /* ---------------- deletions from the other device ---------------- */
  removedByOtherDevice_one: 'Another device deleted {count} item; it was just removed here too.',
  removedByOtherDevice_other: 'Another device deleted {count} items; they were just removed here too.',

  /* ---------------- first bind: which side wins ---------------- */
  choiceTitle: 'The cloud already has data',
  choiceDesc:
    'The cloud copy is not empty, and this device has data too. Only you know how these two should ' +
    'come together — pick one (choose merge if you are unsure):',
  choiceLocalLabel: 'This device',
  choiceRemoteLabel: 'Cloud (written {at})',
  choiceItems_one: '{count} item',
  choiceItems_other: '{count} items',
  choiceMerge: 'Merge (recommended)',
  choiceMergeDesc:
    'Union both sides: anything present in either one is kept, and for a shared id the more recently ' +
    'edited copy wins. The trade-off: categories and locations may end up duplicated, because each ' +
    'device built its own ids and matching names are not treated as the same node.',
  choicePush: 'Replace the cloud with this device',
  choicePushDesc:
    'The cloud copy is replaced wholesale. If that copy holds real data entered on another device, ' +
    'this discards it.',
  choicePull: 'Replace this device with the cloud',
  choicePullDesc:
    'The data on this device is replaced wholesale. Export a backup first if you want it kept.',
  choiceConfirm: 'Use this',
  firstSyncMerged: 'Merged with the cloud.',
  firstSyncPushed: 'The cloud now holds this device’s data.',
  firstSyncPulled: 'This device now holds the cloud’s data.',

  /* ---------------- connection self-check ---------------- */
  probeTitle: 'Test connection',
  probeRunning: 'Testing…',
  probeHint:
    'Three read-only requests: can we reach it, does the table exist, is email sign-in on. ' +
    'No data is written and you do not need to be signed in.',
  probeReachOk: 'Reached it, and this key is accepted',
  probeReachDenied:
    'Reached it, but the key was rejected (usually a truncated copy/paste, or the key was revoked)',
  probeBlocked: 'The request never went out: {message}',
  probeBlockedWithKey:
    'The domain is reachable (the request without a key got through), but the request carrying ' +
    'the key never went out: {message}',
  probeBlockedWithKeyHint:
    'That combination means the domain and the network are fine — it is stuck at the preflight ' +
    '(OPTIONS) that any cross-origin request with custom headers must pass first. The usual ' +
    'suspects are proxy software, security software, or a browser extension modifying or ' +
    'blocking requests with custom headers. Try an incognito window first (extensions are off ' +
    'there by default); if that fails too, temporarily turn off the proxy or security software ' +
    'and try once more to see whether they are the cause.',
  probeBlockedHint:
    'The most common cause is that your proxy is not in effect: your project domain ' +
    '(<project>.supabase.co) gets reset on many networks (TCP connects, then the TLS handshake ' +
    'is killed), while supabase.com — the dashboard domain — works fine. That is what makes ' +
    '"but I can open the dashboard" so misleading. First check that your proxy is running and ' +
    'switch it to global mode, then try again. If the proxy is definitely fine, a browser ' +
    'extension is blocking it: typing the address yourself works while requests made by the page ' +
    'get cut off — exactly what ad-blocking and privacy extensions do. Try an incognito window ' +
    '(extensions are off there by default).',
  probeTableLocked: 'The table exists, and signed-out visitors cannot read it — exactly what we want',
  probeTableMissing: 'The table does not exist yet. Run supabase/schema.sql in the Supabase SQL Editor',
  probeTableOpen: 'Warning: signed-out requests can read data',
  probeTableOpenNote:
    'Row-level security is not in effect, or the anon role was granted read access. Re-run ' +
    'supabase/schema.sql — this is not an incomplete setup, it is a security problem where others ' +
    'may be able to read all of your data.',
  probeAuthOff: 'Email sign-in is off. Enable it under Authentication → Providers → Email',
  probeAuthAuto: 'Email sign-in is on; after registering you can sign in right away (no email confirmation)',
  probeAuthConfirm: 'Email sign-in is on; after registering you must click the link in your inbox to sign in',
  probeSignupOpen:
    'Sign-ups are currently open. Once you have your own account, consider turning them off ' +
    '(Authentication → Allow new users to sign up) — this URL is public, so anyone can register and ' +
    'burn your project quota (they cannot read your data, but it does waste resources).',
  probeSignupClosed:
    'Sign-ups are closed. If you have not registered your own account yet, open them briefly, register, then close them again.',
  probeOdd: 'Unexpected response (see the technical detail below)',
  probeStatus: 'HTTP {status}',

  /* ---------------- sign out ---------------- */
  logoutConfirmTitle: 'Sign out?',
  logoutConfirmBody:
    'Signing out only stops syncing on this device. Nothing local is deleted, and you can sign in again anytime.',
  logoutConfirmNote:
    'Signing in with a different account later asks again which side to use, so accounts cannot get mixed up.',

  /* ---------------- where the data lives ---------------- */
  privacyLead: 'Once signed in, your data is stored in',
  privacyBold: 'your own Supabase project',
  privacyTail:
    ', one row per account. Row-level security in the database is what keeps it readable only by ' +
    'you — the anon key is public (it ships inside the web page), so those policies must be applied ' +
    'when you create the table; supabase/schema.sql already includes them. Local IndexedDB stays the ' +
    'primary copy: keep entering things offline and it catches up when you are back online.',
}
