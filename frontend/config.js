const hostname = window.location.hostname;
const isLocal = window.location.protocol === "file:" ||
  ["localhost", "127.0.0.1", "10.0.2.2"].includes(hostname);
const localApiHost = hostname === "10.0.2.2" ? "10.0.2.2" : "localhost";

window.HELPCONNECT_CONFIG = {
  supabaseUrl: "https://bsslfdqtpalogceqwqux.supabase.co",
  supabaseAnonKey: "sb_publishable_BF1t4vmNG0oIE2vhJCYjZA_q3kU_OgM",
  apiUrl: isLocal
    ? `http://${localApiHost}:3001/api`
    : `${window.location.origin}/api`
};