// Nickname rules: 3-14 chars, letters/numbers/space/_/-, no profanity (leet/spacing aware), no impersonation of staff/CPU.
const BAD = ['fuck','shit','bitch','cunt','dick','cock','pussy','nigg','fag','whore','slut','rape','nazi','hitler','asshole','bastard','retard','penis','vagina','porn','kike','spic','chink','twat','wank','tits','boob','dildo','molest','pedo','kkk','isis','coon','tranny','wetback','gook','fuk','fck','fvck','phuck','jizz'];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '+': 't' };
const flat = (s) => s.toLowerCase().replace(/[0134578@$!+]/g, (c) => LEET[c]).replace(/[^a-z]/g, '');
const squash = (s) => s.replace(/(.)\1+/g, '$1');
const BADS = BAD.map(squash);
function dirty(s) {
  const a = flat(s), b = squash(a);
  return BAD.some((w) => a.includes(w)) || BADS.some((w) => w.length >= 4 && b.includes(w));
}
const RESERVED = /^(admin|administrator|mod|moderator|staff|support|system|server|vwfest|vw fest|cpu|cpu easy|cpu hard|computer|bot|null|undefined|guest|you|opponent|battledubs|battle dubs)$/i;
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,12}[A-Za-z0-9]$/.test(n)) return null;
  if (RESERVED.test(n) || dirty(n)) return null;
  return n;
}
const key = (n) => n.toLowerCase().replace(/[ _-]+/g, '');
module.exports = { cleanName, dirty, nickKey: key };
