/* Password helpers: strength check, strength meter and a strong-password generator.
   Used on sign-up, password reset and "change password". */
(function () {
  "use strict";

  const MIN_LENGTH = 8;

  // A few of the most common passwords (plus FAU-flavored ones) that are never allowed.
  const COMMON = new Set([
    "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123",
    "qwertyuiop", "11111111", "iloveyou", "sunshine", "princess", "football", "baseball",
    "basketball", "letmein1", "welcome1", "admin123", "abc12345", "monkey123", "dragon123",
    "goowls", "goowls1", "gofau", "fauowls", "owls1234", "bocaraton", "floridaatlantic",
  ]);

  const RULES = [
    { id: "length", text: `At least ${MIN_LENGTH} characters`, test: (pw) => pw.length >= MIN_LENGTH },
    { id: "lower", text: "A lowercase letter", test: (pw) => /[a-z]/.test(pw) },
    { id: "upper", text: "An uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
    { id: "number", text: "A number", test: (pw) => /\d/.test(pw) },
    { id: "symbol", text: "A symbol (like ! ? # @)", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
  ];

  const LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];

  // Returns { ok, score (0-4), label, rules: [{id, text, met}], problems: [string] }.
  // "ok" means the password is allowed: long enough, uses at least 3 of the 4
  // character types, isn't a common password and doesn't contain your email name.
  function check(pw, email) {
    pw = pw || "";
    const rules = RULES.map((r) => ({ id: r.id, text: r.text, met: r.test(pw) }));
    const kinds = rules.filter((r) => r.id !== "length" && r.met).length;
    const problems = [];

    const lower = pw.toLowerCase();
    const emailName = (email || "").split("@")[0].toLowerCase();
    const common = COMMON.has(lower) || COMMON.has(lower.replace(/[^a-z0-9]/g, ""));
    const hasEmail = emailName.length >= 4 && lower.includes(emailName);
    const repeats = /(.)\1{3,}/.test(pw);
    if (common) problems.push("This is a very common password.");
    if (hasEmail) problems.push("Don't use your email name in your password.");
    if (repeats) problems.push("Avoid repeating the same character.");

    let score = 0;
    if (pw.length >= MIN_LENGTH) score++;
    if (pw.length >= 12) score++;
    if (kinds >= 3) score++;
    if (kinds === 4 || pw.length >= 16) score++;
    if (common || hasEmail) score = 0;
    else if (repeats) score = Math.max(0, score - 1);
    if (!pw) score = 0;

    const ok = pw.length >= MIN_LENGTH && kinds >= 3 && !common && !hasEmail;
    if (pw && !ok && !problems.length && kinds < 3) problems.push("Mix at least 3 of: lowercase, uppercase, numbers, symbols.");
    // Allowed passwords rate at least "Fair"; anything not allowed rates at most "Weak".
    const final = ok ? Math.max(score, 2) : Math.min(score, 1);
    return { ok, score: final, label: pw ? LABELS[final] : "", rules, problems };
  }

  // A random 16-character password with every character type, from the browser's secure random generator.
  // Look-alike characters (0/O, 1/l/I) are left out so it's easy to read back.
  function generate(length = 16) {
    const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*?-_=+"];
    const all = sets.join("");
    const rand = (n) => {
      // Rejection sampling avoids bias toward the first characters.
      const max = Math.floor(0x100000000 / n) * n;
      const buf = new Uint32Array(1);
      do { crypto.getRandomValues(buf); } while (buf[0] >= max);
      return buf[0] % n;
    };
    const chars = sets.map((s) => s[rand(s.length)]);
    while (chars.length < length) chars.push(all[rand(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
  }

  // Draws the strength bar and checklist into `el`.
  function renderMeter(el, pw, email) {
    const r = check(pw, email);
    el.dataset.score = pw ? r.score : "";
    el.innerHTML = `
      <div class="pw-bar" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<i class="${pw && i < Math.max(1, r.score) ? "on" : ""}"></i>`).join("")}</div>
      <div class="pw-label">${pw ? `Strength: <b>${r.label}</b>` : "Use 8+ characters with a mix of letters, numbers and symbols."}</div>
      <ul class="pw-rules">${r.rules.map((x) => `<li class="${x.met ? "met" : ""}">${x.met ? "✓" : "○"} ${x.text}</li>`).join("")}</ul>
      ${r.problems.length && pw ? `<div class="pw-problem">⚠ ${r.problems[0]}</div>` : ""}`;
    return r;
  }

  window.Password = { check, generate, renderMeter, MIN_LENGTH };
})();
