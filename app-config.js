// Settings for this deployment. Every committed file is served, so nothing
// here may be secret - and in this edition there is nothing secret to hold:
// no accounts, no sign-in, no server of its own.
//
// `usage` is where src/usage.js sends its anonymous counts: the club's
// Supabase project and its PUBLISHABLE key, which is public by design (it
// only ever acts as the anon role, and anon can do exactly one thing there:
// insert a count into training_log_usage - see that table's migration in
// haimuniya/haimunia-app-demo). Never a service-role or secret key. Remove
// `usage` and counting simply stops; nothing else depends on it.
window.HAIMUNIA_CONFIG = Object.freeze({
  supportWhatsApp: "",
  supportEmail: "haimuniya@gmail.com",

  usage: Object.freeze({
    url: "https://hvwakffluwvegedefoth.supabase.co",
    key: "sb_publishable_MRSX0PLMZjoDIX4iuDbI2g_G2EdMRu6",
  }),

  // Connected mode (src/connect.js): the same Supabase project, publishable key
  // (public by design) and the Turnstile site key (public by design) that
  // BOX-LOG uses. Nothing here is secret. Nothing is contacted until a member
  // chooses to connect.
  cloud: Object.freeze({
    supabaseUrl: "https://hvwakffluwvegedefoth.supabase.co",
    supabasePublishableKey: "sb_publishable_MRSX0PLMZjoDIX4iuDbI2g_G2EdMRu6",
    captchaSiteKey: "0x4AAAAAAE6mfjw79idh0ptH",
    app: "club",
  }),

  brand: Object.freeze({
    appName: "האימוניה",
    wordmark: "האימוניה",
    championTitle: "אלוף האימוניה",
  }),
});
